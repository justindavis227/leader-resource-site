/* LRS Edit Mode — v1 (text editing + overflow warnings + save to disk)
   Runs only when the page is opened as a local file in Chrome (file://).
   It never activates on the live site or in the PDF renderer.
   Saving splices changed text back into the original file, so untouched markup stays byte-for-byte the same. */
(function () {
  'use strict';
  var LOCAL = location.protocol === 'file:';
  if (!LOCAL) return;

  var INLINE = /^(b|strong|i|em|u|s|small|span|a|br|sup|sub|mark|abbr|code|q|wbr)$/;
  var SKIP_TAGS = /^(svg|script|style|img|canvas|video|iframe|template|noscript|button|input|select|textarea)$/;
  var SKIP_CLASS = /(^|\s)(foot|pn|ghost|lrs-ui)(\s|$)/;
  var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
  var ENT = { '’': '&rsquo;', '‘': '&lsquo;', '“': '&ldquo;', '”': '&rdquo;', '—': '&mdash;', '–': '&ndash;', '…': '&hellip;', '·': '&middot;', '©': '&copy;', '®': '&reg;', '™': '&trade;', ' ': '&nbsp;' };

  var S = { on: false, src: null, fileName: decodeURIComponent(location.pathname.split('/').pop()), dir: null, blocks: [], ui: null, timer: 0 };

  /* ---------- tiny HTML tokenizer with offsets (source side) ---------- */
  function parse(t) {
    var root = { tag: '#root', children: [], hasText: false, start: 0, innerStart: 0, innerEnd: t.length }, stack = [root], i = 0, n = t.length;
    var openRe = /<([a-zA-Z][\w:-]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/y;
    var closeRe = /<\/([a-zA-Z][\w:-]*)\s*>/y;
    function textSeg(a, b) { if (b > a && /\S/.test(t.slice(a, b))) stack[stack.length - 1].hasText = true; }
    var last = 0;
    while (i < n) {
      var lt = t.indexOf('<', i);
      if (lt < 0) break;
      textSeg(last, lt);
      if (t.startsWith('<!--', lt)) { var e = t.indexOf('-->', lt + 4); i = last = e < 0 ? n : e + 3; continue; }
      if (t.startsWith('<!', lt) || t.startsWith('<?', lt)) { var e2 = t.indexOf('>', lt); i = last = e2 < 0 ? n : e2 + 1; continue; }
      closeRe.lastIndex = lt; var m = closeRe.exec(t);
      if (m) {
        var name = m[1].toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].tag === name) {
            while (stack.length > k) { var nd = stack.pop(); nd.innerEnd = lt; nd.end = closeRe.lastIndex; }
            break;
          }
        }
        i = last = closeRe.lastIndex; continue;
      }
      openRe.lastIndex = lt; m = openRe.exec(t);
      if (!m) { i = lt + 1; continue; }
      var tag = m[1].toLowerCase(), attrs = m[2] || '';
      var node = { tag: tag, attrs: attrs, start: lt, innerStart: openRe.lastIndex, innerEnd: openRe.lastIndex, end: openRe.lastIndex, children: [], hasText: false, parent: stack[stack.length - 1] };
      var cm = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs); node.cls = cm ? (cm[1] || cm[2] || '') : '';
      node.noedit = /\sdata-noedit\b/.test(attrs);
      stack[stack.length - 1].children.push(node);
      i = last = openRe.lastIndex;
      if (m[3] === '/' || VOID.test(tag)) continue;
      if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title') {
        var endTag = t.toLowerCase().indexOf('</' + tag, i);
        if (endTag < 0) endTag = n;
        node.innerEnd = endTag; var gt = t.indexOf('>', endTag); node.end = gt < 0 ? n : gt + 1;
        i = last = node.end; continue;
      }
      stack.push(node);
    }
    return root;
  }

  /* ---------- block detection, same rule on both trees ---------- */
  function srcAdapter(t) {
    return {
      kids: function (nd) { return nd.children; }, tag: function (nd) { return nd.tag; }, cls: function (nd) { return nd.cls || ''; },
      noedit: function (nd) { return nd.noedit; }, direct: function (nd) { return nd.hasText; },
      text: function (nd) { return decode(t.slice(nd.innerStart, nd.innerEnd)); }
    };
  }
  var liveAdapter = {
    kids: function (el) { return Array.prototype.slice.call(el.children); }, tag: function (el) { return el.tagName.toLowerCase(); },
    cls: function (el) { return typeof el.className === 'string' ? el.className : ''; }, noedit: function (el) { return el.hasAttribute('data-noedit'); },
    direct: function (el) { for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test(c.data)) return true; return false; },
    text: function (el) { return el.textContent; }
  };
  function inlineOnly(A, nd) {
    var ks = A.kids(nd);
    for (var i = 0; i < ks.length; i++) { var tg = A.tag(ks[i]); if (!INLINE.test(tg) || !inlineOnly(A, ks[i])) return false; }
    return true;
  }
  function collect(A, nd, out) {
    var tg = A.tag(nd);
    if (SKIP_TAGS.test(tg) || SKIP_CLASS.test(A.cls(nd)) || A.noedit(nd)) return;
    if (tg !== 'section' && inlineOnly(A, nd) && norm(A.text(nd))) { out.push(nd); return; }
    var ks = A.kids(nd); for (var i = 0; i < ks.length; i++) collect(A, ks[i], out);
  }
  function srcSections(root) {
    var out = [];
    (function walk(nd) { nd.children.forEach(function (c) { if (c.tag === 'section' && /(^|\s)page(\s|$)/.test(c.cls)) out.push(c); else walk(c); }); })(root);
    return out;
  }
  var decEl = document.createElement('textarea');
  function decode(html) { decEl.innerHTML = html.replace(/<[^>]*>/g, ''); return decEl.value; }
  function norm(s) { return (s || '').replace(/[\s ]+/g, ' ').trim(); }

  /* ---------- map live blocks to source blocks ---------- */
  function buildMap(text) {
    var root = parse(text), A = srcAdapter(text);
    var ss = srcSections(root), ls = Array.prototype.slice.call(document.querySelectorAll('section.page'));
    if (ss.length !== ls.length) throw new Error('Page count on screen (' + ls.length + ') doesn’t match the file (' + ss.length + '). Reload the page and try again.');
    var blocks = [], miss = 0;
    for (var p = 0; p < ls.length; p++) {
      var sb = [], lb = [];
      collect(A, ss[p], sb); collect(liveAdapter, ls[p], lb);
      var j = 0;
      for (var q = 0; q < lb.length; q++) {
        var lt = norm(lb[q].textContent), hit = -1;
        for (var k = j; k < Math.min(sb.length, j + 4); k++) if (norm(A.text(sb[k])) === lt) { hit = k; break; }
        if (hit < 0) { miss++; lb[q].setAttribute('data-lrs-locked', ''); continue; }
        blocks.push({ el: lb[q], src: sb[hit], page: ls[p], orig: lb[q].innerHTML, srcInner: text.slice(sb[hit].innerStart, sb[hit].innerEnd) });
        j = hit + 1;
      }
    }
    return { blocks: blocks, miss: miss };
  }

  /* ---------- clean the edited HTML before it goes back in the file ---------- */
  function clean(html, srcInner) {
    var h = html.replace(/\s(contenteditable|spellcheck|data-lrs-[\w-]+)(="[^"]*")?/g, '');
    if (srcInner.indexOf('style=') < 0) { for (var r = 0; r < 4; r++) h = h.replace(/<span style="[^"]*">([\s\S]*?)<\/span>/g, '$1'); }
    h = h.replace(/<\/?font[^>]*>/g, '');
    if (!/<br\s*\/?>\s*$/.test(srcInner)) h = h.replace(/(<br\s*\/?>)+\s*$/, '');
    if (srcInner.indexOf('&nbsp;') < 0 && srcInner.indexOf(' ') < 0) h = h.replace(/&nbsp;| /g, ' ');
    h = h.replace(/[’‘“”—–…·©®™ ]/g, function (c) { return ENT[c]; });
    return h;
  }
  function serialize() {
    var edits = [];
    S.blocks.forEach(function (b) { if (b.el.innerHTML !== b.orig) edits.push({ a: b.src.innerStart, z: b.src.innerEnd, html: clean(b.el.innerHTML, b.srcInner) }); });
    edits.sort(function (x, y) { return y.a - x.a; });
    var t = S.src;
    edits.forEach(function (e) { t = t.slice(0, e.a) + e.html + t.slice(e.z); });
    return { text: t, count: edits.length };
  }
  function dirtyCount() { var c = 0; S.blocks.forEach(function (b) { if (b.el.innerHTML !== b.orig) c++; }); return c; }

  /* ---------- overflow warnings ---------- */
  function checkOverflow() {
    var bad = [];
    document.querySelectorAll('section.page').forEach(function (sec) {
      var old = sec.querySelector(':scope > .lrs-ui.lrs-flag'); if (old) old.remove();
      sec.classList.remove('lrs-over');
      var sr = sec.getBoundingClientRect(); if (!sr.height) return;
      var foot = sec.querySelector(':scope > .foot'), scale = sr.height / sec.offsetHeight, over = false, limit = sr.bottom - 12 * scale;
      if (foot) foot.querySelectorAll('span').forEach(function (s) { var fr = s.getBoundingClientRect(); if (fr.height && fr.top < limit) limit = fr.top; });
      var els = sec.querySelectorAll('[data-lrs-block], [data-lrs-locked]');
      for (var i = 0; i < els.length && !over; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.height && r.bottom > limit + 2 * scale && !(foot && foot.contains(els[i]))) over = true;
        if (r.height && r.right > sr.right + 2 * scale) over = true;
      }
      if (over) {
        bad.push(sec); sec.classList.add('lrs-over');
        var f = document.createElement('div'); f.className = 'lrs-ui lrs-flag'; f.textContent = 'Text runs past the page';
        sec.appendChild(f);
      }
    });
    S.over = bad; return bad;
  }

  /* ---------- folder access (Chrome File System Access API) ---------- */
  function idb(fn) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('lrs-edit', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { var tx = rq.result.transaction('kv', 'readwrite'); fn(tx.objectStore('kv'), res); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function loadDir() { return idb(function (st, res) { var g = st.get('dir'); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }); }
  function saveDir(h) { return idb(function (st, res) { st.put(h, 'dir'); res(true); }); }
  async function ensureDir() {
    if (!window.showDirectoryPicker) throw new Error('This browser can’t save files directly. Open the booklet in Google Chrome.');
    if (!S.dir) S.dir = await loadDir();
    if (S.dir) {
      var p = await S.dir.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await S.dir.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') { try { await S.dir.getFileHandle(S.fileName); return S.dir; } catch (e) { S.dir = null; } }
      else S.dir = null;
    }
    toast('Choose your <b>leader-resource-site</b> folder so edits can save. You only do this once.', 6000);
    var h = await window.showDirectoryPicker({ id: 'lrs', mode: 'readwrite' });
    try { await h.getFileHandle(S.fileName); } catch (e) { throw new Error('That folder doesn’t contain “' + S.fileName + '.” Pick the leader-resource-site folder.'); }
    S.dir = h; saveDir(h); return h;
  }
  async function readFile() { var fh = await (await ensureDir()).getFileHandle(S.fileName); return await (await fh.getFile()).text(); }
  async function writeFile(text) { var fh = await S.dir.getFileHandle(S.fileName); var w = await fh.createWritable(); await w.write(text); await w.close(); }

  /* ---------- turning edit mode on/off ---------- */
  async function enable(sourceText) {
    try {
      var text = sourceText != null ? sourceText : await readFile();
      var m = buildMap(text);
      S.src = text; S.blocks = m.blocks; S.on = true;
      S.blocks.forEach(function (b) { b.el.setAttribute('data-lrs-block', ''); b.el.contentEditable = 'true'; b.el.spellcheck = true; });
      document.documentElement.classList.add('lrs-editing');
      checkOverflow(); render();
      toast(S.blocks.length + ' text blocks ready to edit' + (m.miss ? ' · ' + m.miss + ' locked (couldn’t match the file)' : '') + (S.over.length ? ' · ' + S.over.length + ' page' + (S.over.length > 1 ? 's' : '') + ' already overflowing' : ''), 4000);
    } catch (e) { if (e && e.name === 'AbortError') return; toast(esc(e.message || String(e)), 7000, true); }
  }
  function disable() {
    if (dirtyCount() && !confirm('You have unsaved changes. Discard them and leave edit mode?')) return;
    S.blocks.forEach(function (b) { if (b.el.innerHTML !== b.orig) b.el.innerHTML = b.orig; b.el.removeAttribute('contenteditable'); b.el.removeAttribute('data-lrs-block'); });
    document.querySelectorAll('[data-lrs-locked]').forEach(function (e) { e.removeAttribute('data-lrs-locked'); });
    document.querySelectorAll('.lrs-ui.lrs-flag').forEach(function (e) { e.remove(); });
    document.querySelectorAll('.lrs-over').forEach(function (e) { e.classList.remove('lrs-over'); });
    S.on = false; S.blocks = []; document.documentElement.classList.remove('lrs-editing'); render();
  }
  async function save() {
    if (!S.on) return;
    var c = dirtyCount(); if (!c) { toast('No changes to save.'); return; }
    try {
      await ensureDir();
      var disk = await readFile();
      if (disk !== S.src) { toast('This file changed on your Mac since you started editing (maybe Claude saved a new version). Copy your edits somewhere, reload, and redo them so nothing gets overwritten.', 10000, true); return; }
      var out = serialize();
      await writeFile(out.text);
      var nm = buildMap(out.text);
      S.blocks.forEach(function (b) { b.el.removeAttribute('data-lrs-block'); });
      S.src = out.text; S.blocks = nm.blocks;
      S.blocks.forEach(function (b) { b.el.setAttribute('data-lrs-block', ''); b.el.contentEditable = 'true'; });
      render(); checkOverflow(); render();
      toast('Saved ' + out.count + ' change' + (out.count > 1 ? 's' : '') + ' to “' + esc(S.fileName) + '.” Commit and push when you’re ready.', 5000);
    } catch (e) { if (e && e.name === 'AbortError') return; toast('Couldn’t save: ' + esc(e.message || String(e)), 8000, true); }
  }

  /* ---------- editing behaviour ---------- */
  document.addEventListener('keydown', function (e) {
    var inBlock = e.target && e.target.closest && e.target.closest('[data-lrs-block]');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && S.on) { e.preventDefault(); save(); return; }
    if (inBlock && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) document.execCommand('insertLineBreak'); return; }
    if (inBlock && e.key === 'Escape') { inBlock.blur(); return; }
    if (!inBlock && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'e' && !/input|textarea|select/i.test(e.target.tagName || '')) { S.on ? disable() : enable(); }
  }, true);
  document.addEventListener('paste', function (e) {
    if (!(e.target.closest && e.target.closest('[data-lrs-block]'))) return;
    e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, t);
  }, true);
  document.addEventListener('input', function (e) {
    if (!(e.target.closest && e.target.closest('[data-lrs-block]'))) return;
    clearTimeout(S.timer); S.timer = setTimeout(function () { checkOverflow(); render(); }, 250); render();
  }, true);
  window.addEventListener('beforeunload', function (e) { if (S.on && dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- UI ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var css = '\n#lrs-bar{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;gap:8px;align-items:center;font:500 13px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;background:#111;color:#fff;padding:8px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25)}' +
    '#lrs-bar button{font:inherit;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;background:#2a2a2a;color:#fff}#lrs-bar button:hover{background:#3a3a3a}' +
    '#lrs-bar button.pri{background:#e01b2f}#lrs-bar button.pri:hover{background:#c41626}#lrs-bar button:disabled{opacity:.45;cursor:default}' +
    '#lrs-bar .st{padding:0 6px;color:#bbb;white-space:nowrap}#lrs-bar .warn{color:#ffb3ba;cursor:pointer;text-decoration:underline;text-underline-offset:2px}' +
    '#lrs-toast{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:2147483001;max-width:min(560px,calc(100vw - 32px));background:#111;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)}#lrs-toast.err{background:#8e0f1b}' +
    'html.lrs-editing [data-lrs-block]{outline:1px dashed rgba(224,27,47,0);outline-offset:2px;transition:outline-color .15s;cursor:text}' +
    'html.lrs-editing [data-lrs-block]:hover{outline-color:rgba(224,27,47,.55)}' +
    'html.lrs-editing [data-lrs-block]:focus{outline:2px solid #e01b2f;outline-offset:2px}' +
    'html.lrs-editing section.page.lrs-over{outline:4px solid #e01b2f;outline-offset:-4px}' +
    '.lrs-ui.lrs-flag{position:absolute;top:8px;right:8px;z-index:50;background:#e01b2f;color:#fff;font:600 11px/1 -apple-system,system-ui,sans-serif;padding:6px 8px;border-radius:6px;letter-spacing:.02em;pointer-events:none}' +
    '@media print{#lrs-bar,#lrs-toast,.lrs-ui{display:none!important}}\n';
  function render() {
    if (!S.ui) {
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      S.ui = document.createElement('div'); S.ui.id = 'lrs-bar'; S.ui.className = 'lrs-ui'; document.body.appendChild(S.ui);
      S.ui.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act');
        if (a === 'edit') enable(); else if (a === 'done') disable(); else if (a === 'save') save();
        else if (a === 'next' && S.over && S.over.length) { S.oi = ((S.oi || 0) + 1) % S.over.length; S.over[S.oi].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    }
    if (!S.on) { S.ui.innerHTML = '<button data-act="edit" title="Edit text (E)">✎ Edit text</button>'; return; }
    var c = dirtyCount(), o = (S.over || []).length;
    S.ui.innerHTML = (o ? '<span class="st warn" data-act="next" title="Jump to the next overflowing page">⚠ ' + o + ' page' + (o > 1 ? 's' : '') + ' overflowing</span>' : '') +
      '<span class="st">' + (c ? c + ' unsaved change' + (c > 1 ? 's' : '') : 'No changes') + '</span>' +
      '<button class="pri" data-act="save"' + (c ? '' : ' disabled') + ' title="Save (⌘S)">Save</button><button data-act="done" title="Leave edit mode (E)">Done</button>';
  }
  var tt = 0;
  function toast(html, ms, err) {
    var el = document.getElementById('lrs-toast');
    if (!el) { el = document.createElement('div'); el.id = 'lrs-toast'; el.className = 'lrs-ui'; document.body.appendChild(el); }
    el.innerHTML = html; el.classList.toggle('err', !!err); el.style.display = 'block';
    clearTimeout(tt); tt = setTimeout(function () { el.style.display = 'none'; }, ms || 3000);
  }

  window.LRSEdit = { enable: enable, disable: disable, save: save, _serialize: serialize, _parse: parse, _state: S, _check: checkOverflow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
