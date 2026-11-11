/* LRS Edit Mode — v1 (text editing + overflow warnings + save to disk)
   Runs only when the page is opened as a local file in Chrome (file://).
   It never activates on the live site or in the PDF renderer.
   Saving splices changed text back into the original file, so untouched markup stays byte-for-byte the same. */
(function () {
  'use strict';
  var LOCAL = location.protocol === 'file:';
  if (!LOCAL) return;

  var INLINE = /^(b|strong|i|em|u|s|small|span|a|br|sup|sub|mark|abbr|code|q|wbr)$/;
  var SKIP_TAGS = /^(svg|script|style|img|canvas|video|iframe|template|noscript|button|input|select|textarea|nav|helmet|head|link|meta)$/;
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
  /* Three kinds of page on the site:
     booklet = <section class="page"> pages (spreads, folios)
     deck    = <section data-label> slides
     doc     = everything else (R-pages, notes, the library hub): the whole body is one unit */
  function mode() { if (S.data) return 'data'; if (document.querySelector('section.page')) return 'booklet'; if (document.querySelector('section[data-label]')) return 'deck'; return 'doc'; }
  function liveUnits() {
    var m = mode();
    if (m === 'booklet') return Array.prototype.slice.call(document.querySelectorAll('section.page'));
    if (m === 'data') return Array.prototype.slice.call(document.querySelectorAll('section.pg, section.page'));
    if (m === 'deck') return Array.prototype.slice.call(document.querySelectorAll('section[data-label]'));
    return [document.body];
  }
  function srcSections(root) {
    var m = mode(), out = [];
    if (m === 'doc') {
      var body = null; (function walk(nd) { nd.children.forEach(function (c) { if (body) return; if (c.tag === 'body') body = c; else walk(c); }); })(root);
      return [body || root];
    }
    (function walk(nd) { nd.children.forEach(function (c) {
      var hit = c.tag === 'section' && (m === 'booklet' ? /(^|\s)page(\s|$)/.test(c.cls) : /\sdata-label\s*=/.test(c.attrs || ''));
      if (hit) out.push(c); else walk(c); }); })(root);
    return out;
  }
  var decEl = document.createElement('textarea');
  function decode(html) { decEl.innerHTML = html.replace(/<[^>]*>/g, ''); return decEl.value; }
  function norm(s) { return (s || '').replace(/[\s ]+/g, ' ').trim(); }

  /* ---------- map live blocks to source blocks ---------- */
  function buildMap(text) {
    var root = parse(text), A = srcAdapter(text);
    var ss = srcSections(root), ls = liveUnits();
    if (ss.length !== ls.length) throw new Error('Page count on screen (' + ls.length + ') doesn’t match the file (' + ss.length + '). Reload the page and try again.');
    var blocks = [], miss = 0, pend = [], usedSrc = new Set();
    for (var p = 0; p < ls.length; p++) {
      var sb = [], lb = [];
      collect(A, ss[p], sb); collect(liveAdapter, ls[p], lb);
      var j = 0;
      for (var q = 0; q < lb.length; q++) {
        var lt = norm(lb[q].textContent), hit = -1;
        for (var k = j; k < Math.min(sb.length, j + 40); k++) if (norm(A.text(sb[k])) === lt) { hit = k; break; }
        if (hit < 0) { pend.push({ el: lb[q], t: lt, sb: sb, page: ls[p] }); continue; }
        usedSrc.add(sb[hit]); blocks.push({ el: lb[q], src: sb[hit], page: ls[p], orig: lb[q].innerHTML, srcInner: text.slice(sb[hit].innerStart, sb[hit].innerEnd) });
        j = hit + 1;
      }
    }
    // second pass: anything the screen shows in a different order still matches if its text is unique in the file
    pend.forEach(function (x) {
      var c = x.sb.filter(function (s) { return !usedSrc.has(s) && norm(A.text(s)) === x.t; });
      var twins = pend.filter(function (y) { return y.t === x.t; }).length;
      if (c.length === 1 && twins === 1) { usedSrc.add(c[0]); blocks.push({ el: x.el, src: c[0], page: x.page, orig: x.el.innerHTML, srcInner: text.slice(c[0].innerStart, c[0].innerEnd) }); }
      else { miss++; x.el.setAttribute('data-lrs-locked', ''); }
    });
    return { blocks: blocks, miss: miss };
  }

  /* ---------- clean the edited HTML before it goes back in the file ---------- */
  function clean(html, srcInner) {
    var h = html.replace(/\s(contenteditable|spellcheck|data-lrs-[\w-]+|data-dc-[\w-]+)(="[^"]*")?/g, '');
    if (srcInner.indexOf('style=') < 0) { for (var r = 0; r < 4; r++) h = h.replace(/<span style="[^"]*">([\s\S]*?)<\/span>/g, '$1'); }
    h = h.replace(/<\/?font[^>]*>/g, '');
    if (!/<br\s*\/?>\s*$/.test(srcInner)) h = h.replace(/(<br\s*\/?>)+\s*$/, '');
    if (srcInner.indexOf('&nbsp;') < 0 && srcInner.indexOf(' ') < 0) h = h.replace(/&nbsp;| /g, ' ');
    h = h.replace(/[’‘“”—–…·©®™ ]/g, function (c) { return ENT[c]; });
    return h;
  }
  function serialize() {
    if (S.data) return serializeLits();
    var edits = [];
    S.blocks.forEach(function (b) { if (b.el.innerHTML !== b.orig) edits.push({ a: b.src.innerStart, z: b.src.innerEnd, html: clean(b.el.innerHTML, b.srcInner) }); });
    edits.sort(function (x, y) { return y.a - x.a; });
    var t = S.src;
    edits.forEach(function (e) { t = t.slice(0, e.a) + e.html + t.slice(e.z); });
    return { text: t, count: edits.length };
  }
  function isDirty(b) { return b.kind === 'lit' ? litDirty(b) : b.el.innerHTML !== b.orig; }
  function mergeOnto(disk) {
    var edits = [], lost = [];
    var lits = new Map();
    S.blocks.forEach(function (b) {
      if (!isDirty(b)) return;
      if (b.kind === 'lit') { lits.set(b.lit, litVal(b)); return; }
      var from = b.srcInner, i = disk.indexOf(from);
      if (i < 0 || disk.indexOf(from, i + 1) >= 0) { lost.push(b.el.textContent.trim()); return; }
      edits.push({ a: i, z: i + from.length, html: clean(b.el.innerHTML, b.srcInner) });
    });
    lits.forEach(function (v, l) {
      var from = l.q + l.raw + l.q, i = disk.indexOf(from);
      if (i < 0 || disk.indexOf(from, i + 1) >= 0) { lost.push(v); return; }
      edits.push({ a: i + 1, z: i + 1 + l.raw.length, html: enc(v, l.q) });
    });
    edits.sort(function (x, y) { return y.a - x.a; });
    var t = disk; edits.forEach(function (e) { t = t.slice(0, e.a) + e.html + t.slice(e.z); });
    return { text: t, count: edits.length, lost: lost };
  }
  function dirtyCount() { var c = 0; S.blocks.forEach(function (b) { if (isDirty(b)) c++; }); return c; }

  /* ---------- overflow warnings ---------- */
  function checkOverflow() {
    var bad = [];
    if (mode() !== 'booklet' && mode() !== 'data') { S.over = []; return []; } // decks animate builds off-canvas on purpose, so no overflow check there
    liveUnits().forEach(function (sec) {
      var old = sec.querySelector(':scope > .lrs-ui.lrs-flag'); if (old) old.remove();
      sec.classList.remove('lrs-over');
      var sr = sec.getBoundingClientRect(); if (!sr.height) return;
      var foot = sec.querySelector(':scope > .foot'), scale = sr.height / sec.offsetHeight, over = false, limit = sr.bottom - 12 * scale;
      var absEls = [];
      if (!foot) sec.querySelectorAll('*').forEach(function (e) { // template pages: footer text is absolutely positioned in the bottom margin
        if (e.closest('.lrs-ui')) return; var cs = getComputedStyle(e); if (cs.position !== 'absolute') return;
        var r = e.getBoundingClientRect(); if (r.height && r.top > sr.top + sr.height * 0.8 && /\S/.test(e.textContent)) { absEls.push(e); if (r.top < limit) limit = r.top; }
      });
      if (foot) foot.querySelectorAll('span').forEach(function (s) { var fr = s.getBoundingClientRect(); if (fr.height && fr.top < limit) limit = fr.top; });
      var els = sec.querySelectorAll('[data-lrs-block], [data-lrs-locked]');
      for (var i = 0; i < els.length && !over; i++) {
        var r = els[i].getBoundingClientRect();
        var inAbs = absEls.some(function (x) { return x.contains(els[i]); });
        if (!inAbs && r.height && r.bottom > limit + 2 * scale && !(foot && foot.contains(els[i]))) over = true;
        if (!inAbs && r.height && r.right > sr.right + 2 * scale) over = true;
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
      S.data = /<sc-for\b/.test(text);
      var m = S.data ? buildLitMap(text) : buildMap(text);
      S.src = text; S.blocks = m.blocks; S.on = true;
      S.blocks.forEach(function (b) { b.el.setAttribute('data-lrs-block', ''); b.el.contentEditable = 'true'; b.el.spellcheck = true; });
      document.documentElement.classList.add('lrs-editing');
      checkOverflow(); render();
      toast(S.blocks.length + ' text blocks ready to edit' + (m.miss ? ' · ' + m.miss + ' locked (couldn’t match the file)' : '') + (S.over.length ? ' · ' + S.over.length + ' page' + (S.over.length > 1 ? 's' : '') + ' already overflowing' : ''), 4000);
    } catch (e) { if (e && e.name === 'AbortError') return; toast(esc(e.message || String(e)), 7000, true); }
  }
  function disable() {
    if (dirtyCount() && !confirm('You have unsaved changes. Discard them and leave edit mode?')) return;
    S.blocks.forEach(function (b) { if (isDirty(b)) { if (b.kind === 'lit') b.el.innerText = b.orig; else b.el.innerHTML = b.orig; } b.el.removeAttribute('contenteditable'); b.el.removeAttribute('data-lrs-block'); });
    document.querySelectorAll('[data-lrs-locked]').forEach(function (e) { e.removeAttribute('data-lrs-locked'); });
    document.querySelectorAll('.lrs-ui.lrs-flag').forEach(function (e) { e.remove(); });
    document.querySelectorAll('.lrs-over').forEach(function (e) { e.classList.remove('lrs-over'); });
    S.on = false; S.blocks = []; document.documentElement.classList.remove('lrs-editing'); render();
  }
  async function save() {
    if (!S.on) return;
    var c = dirtyCount(); if (!c) { toast('No changes to save.'); return true; }
    try {
      await ensureDir();
      var disk = await readFile();
      var out;
      if (disk !== S.src) {
        // the file changed underneath you (e.g. Claude saved a new version): carry your edits onto the new file
        var mg = mergeOnto(disk);
        if (mg.lost.length) { toast('This file changed on your Mac while you were editing, and ' + mg.lost.length + ' of your edits sit on text that also changed:<br>\u2022 ' + mg.lost.map(function (s) { return esc(s.slice(0, 60)); }).join('<br>\u2022 ') + '<br>Copy those somewhere, reload, and redo them.', 15000, true); return false; }
        out = mg; out.merged = true;
      } else out = serialize();
      await writeFile(out.text);
      if (out.merged) { try { sessionStorage.setItem('lrs-reenter', '1'); } catch (x) {} toast('Saved ' + out.count + ' change' + (out.count > 1 ? 's' : '') + ', merged with the newer version on your Mac. Reloading\u2026', 3000); setTimeout(function () { location.reload(); }, 900); return true; }
      var nm = S.data ? (S.blocks.forEach(function (b) { b.el.removeAttribute('contenteditable'); }), buildLitMap(out.text)) : buildMap(out.text);
      S.blocks.forEach(function (b) { b.el.removeAttribute('data-lrs-block'); });
      S.src = out.text; S.blocks = nm.blocks;
      S.blocks.forEach(function (b) { b.el.setAttribute('data-lrs-block', ''); b.el.contentEditable = 'true'; });
      render(); checkOverflow(); render();
      toast('Saved ' + out.count + ' change' + (out.count > 1 ? 's' : '') + ' to “' + esc(S.fileName) + '.” Commit and push when you’re ready.', 5000);
      return true;
    } catch (e) { if (e && e.name === 'AbortError') return false; toast('Couldn’t save: ' + esc(e.message || String(e)), 8000, true); return false; }
  }

  /* ---------- editing behaviour ---------- */
  window.addEventListener('keydown', function (e) {
    var inBlock = e.target && e.target.closest && e.target.closest('[data-lrs-block]');
    if ((e.metaKey || e.ctrlKey) && e.key && e.key.toLowerCase() === 's' && S.on) { e.preventDefault(); save(); return; }
    if (inBlock && S.data && (e.metaKey || e.ctrlKey) && /^[biu]$/i.test(e.key || '')) { e.preventDefault(); return; }
    if (inBlock && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) document.execCommand('insertLineBreak'); return; }
    if (inBlock && e.key === 'Escape') { inBlock.blur(); return; }
    if (inBlock) { e.stopPropagation(); return; } // keep slide decks from changing slides while typing
    if (SO || DM) { if (e.key === 'Escape') closeSorter(); e.stopPropagation(); return; }
    if (!inBlock && !e.metaKey && !e.ctrlKey && !e.altKey && e.key && e.key.toLowerCase() === 'e' && !/input|textarea|select/i.test(e.target.tagName || '')) { S.on ? disable() : enable(); }
  }, true);
  document.addEventListener('click', function (e) { if (S.on && e.target.closest && e.target.closest('[data-lrs-block]') && e.target.closest('a')) e.preventDefault(); }, true);
  document.addEventListener('paste', function (e) {
    if (!(e.target.closest && e.target.closest('[data-lrs-block]'))) return;
    e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, t);
  }, true);
  document.addEventListener('input', function (e) {
    var blk = e.target.closest && e.target.closest('[data-lrs-block]'); if (!blk) return;
    S.blocks.forEach(function (b) { if (b.el === blk && b.kind === 'lit') b.val = blk.innerText; });
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
  /* =====================================================================
     PAGE SORTER (v1 step 2): drag pages, warnings, renumber on save
     ===================================================================== */
  var BLANK_HTML = '<section class="page" data-screen-label="Blank"></section>';
  function attr(nd, name) { var m = new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"').exec(nd.attrs || ''); return m ? m[1] : null; }
  function units(text) {
    var root = parse(text), ss = srcSections(root), out = [], dk = mode() === 'deck';
    ss.forEach(function (nd, k) {
      var leadFrom = k ? ss[k - 1].end : nd.start, leadRaw = text.slice(leadFrom, nd.start), lead = leadRaw.trim();
      var html = text.slice(nd.start, nd.end), label = decode(attr(nd, dk ? 'data-label' : 'data-screen-label') || '');
      var sp = attr(nd, 'data-spread'), m = /\((Left|Right)\)\s*$/.exec(label), spread = null;
      if (sp) { var pp = sp.split(':'); spread = { side: pp[0].toUpperCase().charAt(0), key: pp[1] || label }; }
      else if (m) spread = { side: m[1].charAt(0), key: label.replace(/\s*\((Left|Right)\)\s*$/, '') };
      var pnm = /<span class="pn">\s*(\d+)\s*<\/span>/.exec(html);
      out.push({ k: k, leadRaw: leadRaw, start: nd.start, end: nd.end, lead: lead, html: html, label: label, spread: spread,
        divider: /(^|\s)divider(\s|$)/.test(nd.cls) || /^Divider/.test(label), pn: pnm ? pnm[1] : null });
    });
    return out;
  }
  var SO = null; // sorter state
  function THW() { return mode() === 'deck' ? 240 : 150; }
  function openSorter() {
    if (!S.on) { toast('Turn on edit mode first.'); return; }
    if (mode() === 'doc') { toast('This page doesn\u2019t have separate pages to rearrange.'); return; }
    var us = units(S.src), live = liveUnits();
    if (us.length !== live.length) { toast('Couldn’t line up the pages with the file. Reload and try again.', 6000, true); return; }
    var uid = 0;
    SO = { units: us, items: us.map(function (u, i) { return { id: ++uid, u: u, el: live[i], label: u.label, spread: u.spread, divider: u.divider }; }), uid: uid,
      firstLabel: us[0] && us[0].label, lastLabel: us[us.length - 1] && us[us.length - 1].label, deleted: [] };
    var ov = document.createElement('div'); ov.id = 'lrs-sorter'; ov.className = 'lrs-ui';
    ov.innerHTML = '<div class="sh"><div class="st1">Pages</div><div class="sw"></div><div class="sb"><button data-s="cancel">Cancel</button><button class="pri" data-s="save">Save order</button></div></div><div class="sg"></div>';
    document.body.appendChild(ov); document.documentElement.classList.add('lrs-sorting');
    ov.addEventListener('click', sorterClick);
    paintSorter();
  }
  function closeSorter() { DM = null; var ov = document.getElementById('lrs-sorter'); if (ov) ov.remove(); document.documentElement.classList.remove('lrs-sorting'); SO = null; }
  function thumb(it) {
    var w = document.createElement('div'); w.className = 'th';
    if (it.el) {
      var c = it.el.cloneNode(true);
      c.querySelectorAll('[id]').forEach(function (e) { e.removeAttribute('id'); }); c.removeAttribute('id');
      c.querySelectorAll('[contenteditable]').forEach(function (e) { e.removeAttribute('contenteditable'); });
      c.querySelectorAll('.lrs-ui').forEach(function (e) { e.remove(); });
      var dk = mode() === 'deck', W = dk ? 1920 : 768, H = dk ? 1080 : 768;
      c.classList.remove('lrs-over'); c.style.cssText += ';display:block;visibility:visible;opacity:1;position:absolute;left:0;top:0;margin:0;width:' + W + 'px;height:' + H + 'px;transform:scale(' + (THW() / W) + ');transform-origin:0 0;pointer-events:none;box-shadow:none';
      w.style.height = Math.round(THW() * H / W) + 'px';
      w.appendChild(c);
    } else { w.innerHTML = '<div class="nb">' + esc(it.label) + '</div>'; }
    return w;
  }
  function problems() {
    var it = SO.items, P = [], n = it.length;
    if (mode() === 'deck') return P;
    function add(i, msg, fix) { P.push({ i: i, msg: msg, fix: fix }); }
    if (SO.firstLabel === 'Cover' && it[0] && it[0].label !== 'Cover') add(0, 'The cover isn’t the first page', null);
    var hasBack = SO.lastLabel === 'Back cover';
    if (hasBack && it[n - 1] && it[n - 1].label !== 'Back cover') add(n - 1, 'The back cover isn’t the last page', null);
    it.forEach(function (x, i) {
      if (x.divider && i % 2 === 0) add(i, '“' + x.label.replace(/^Divider—/, '') + '” section starts on a right page', { t: 'blank', i: i });
      if (x.spread && x.spread.side === 'L') {
        var nx = it[i + 1];
        if (!(nx && nx.spread && nx.spread.side === 'R' && nx.spread.key === x.spread.key)) add(i, '“' + x.spread.key + '” spread is split apart', { t: 'join', i: i });
        else if (i % 2 === 0) add(i, '“' + x.spread.key + '” spread doesn’t open on a left page', { t: 'blank', i: i });
      }
    });
    if (n % 4) add(n - 1, n + ' pages—a printed booklet needs a multiple of 4 (' + (n + 4 - n % 4) + ')', { t: 'pad' });
    return P;
  }
  function applyFix(f) {
    var it = SO.items;
    if (f.t === 'blank') it.splice(f.i, 0, newItem('blank'));
    else if (f.t === 'join') {
      var L = it[f.i], ri = it.findIndex(function (x) { return x.spread && x.spread.side === 'R' && x.spread.key === L.spread.key; });
      if (ri >= 0) { var R = it.splice(ri, 1)[0]; it.splice(it.indexOf(L) + 1, 0, R); }
    } else if (f.t === 'pad') {
      var need = (4 - it.length % 4) % 4, at = SO.lastLabel === 'Back cover' && it[it.length - 1].label === 'Back cover' ? it.length - 1 : it.length;
      for (var q = 0; q < need; q++) it.splice(at, 0, newItem('blank'));
    }
  }
  function newItem(kind, from) {
    SO.uid++;
    if (kind === 'blank') return { id: SO.uid, u: null, html: mode() === 'deck' ? '<section data-label="Blank"></section>' : BLANK_HTML, label: 'Blank', el: null, isNew: true };
    return { id: SO.uid, u: from.u, html: from.u ? from.u.html : from.html, lead: '', label: from.label + ' (copy)', el: from.el, spread: null, divider: from.divider, isNew: true, dupOf: from };
  }
  function paintSorter() {
    var ov = document.getElementById('lrs-sorter'); if (!ov) return;
    var P = problems(), bad = {}; P.forEach(function (p) { (bad[p.i] = bad[p.i] || []).push(p); });
    ov.querySelector('.st1').textContent = 'Pages · ' + SO.items.length;
    var fixable = P.filter(function (p) { return p.fix; }).length;
    ov.querySelector('.sw').innerHTML = P.length ? '<span class="wn">⚠ ' + P.length + ' layout issue' + (P.length > 1 ? 's' : '') + '</span>' + (fixable ? '<button data-s="fixall">Fix with blanks</button>' : '') : '<span class="ok">✓ Layout rules all pass</span>';
    var g = ov.querySelector('.sg'); g.innerHTML = '';
    var it = SO.items, spreads = [];
    if (mode() === 'deck') it.forEach(function (_, i) { spreads.push([i]); });
    else { spreads.push([null, 0]); for (var i = 1; i < it.length; i += 2) spreads.push([i, i + 1 < it.length ? i + 1 : null]); }
    spreads.forEach(function (pair) {
      var sp = document.createElement('div'); sp.className = 'sp';
      pair.forEach(function (i, side) {
        var slot = document.createElement('div'); slot.className = 'slot';
        if (i == null) { slot.classList.add('empty'); sp.appendChild(slot); return; }
        var x = it[i]; slot.dataset.idx = i; slot.draggable = true;
        if (bad[i]) slot.classList.add('bad');
        if (x.isNew) slot.classList.add('new');
        slot.appendChild(thumb(x));
        var folio = mode() === 'deck' ? String(i + 1) : (i === 0 ? '' : String(i).padStart(2, '0'));
        slot.insertAdjacentHTML('beforeend', '<div class="cap"><b>' + (folio || '—') + '</b> ' + esc(x.label) + '</div>' +
          '<div class="act"><button data-s="dup" title="Duplicate">⧉</button><button data-s="addblank" title="Insert a blank page before">+ Blank</button><button data-s="del" title="Delete page">✕</button></div>' +
          (bad[i] ? '<div class="pb">' + bad[i].map(function (p) { return esc(p.msg); }).join('<br>') + '</div>' : ''));
        sp.appendChild(slot);
      });
      g.appendChild(sp);
    });
    wireDrag(g);
  }
  function wireDrag(g) {
    var dragId = null;
    g.querySelectorAll('.slot[data-idx]').forEach(function (s) {
      s.addEventListener('dragstart', function (e) { dragId = +s.dataset.idx; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'p'); } catch (x) {} s.classList.add('drag'); });
      s.addEventListener('dragend', function () { s.classList.remove('drag'); });
      s.addEventListener('dragover', function (e) {
        e.preventDefault(); var r = s.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
        g.querySelectorAll('.dropL,.dropR').forEach(function (z) { z.classList.remove('dropL', 'dropR'); });
        s.classList.add(after ? 'dropR' : 'dropL');
      });
      s.addEventListener('dragleave', function () { s.classList.remove('dropL', 'dropR'); });
      s.addEventListener('drop', function (e) {
        e.preventDefault(); if (dragId == null) return;
        var r = s.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2, target = +s.dataset.idx;
        movePages(dragId, target, after); dragId = null; paintSorter();
      });
    });
  }
  function movePages(from, target, after) {
    var it = SO.items, x = it[from], group = [x];
    if (x.spread) {
      var partner = it.find(function (y) { return y !== x && y.spread && y.spread.key === x.spread.key; });
      if (partner) group = x.spread.side === 'L' ? [x, partner] : [partner, x];
    }
    var tItem = it[target]; if (group.indexOf(tItem) >= 0) return;
    group.forEach(function (g) { it.splice(it.indexOf(g), 1); });
    var ti = it.indexOf(tItem) + (after ? 1 : 0);
    if (tItem.spread && tItem.spread.side === 'L' && after) ti++; // don't drop between a spread's two pages
    if (tItem.spread && tItem.spread.side === 'R' && !after) ti--;
    it.splice.apply(it, [Math.max(0, ti), 0].concat(group));
  }
  function sorterClick(e) {
    var b = e.target.closest('[data-s]'); if (!b) return;
    var a = b.getAttribute('data-s'), slot = b.closest('.slot'), i = slot ? +slot.dataset.idx : -1, it = SO && SO.items;
    if (a === 'cancel') { closeSorter(); return; }
    if (a === 'save') { saveOrder(); return; }
    if (a === 'fixall') { for (var guard = 0; guard < 40; guard++) { var p = problems().filter(function (q) { return q.fix; })[0]; if (!p) break; applyFix(p.fix); } }
    if (a === 'dup') it.splice(i + 1, 0, newItem('dup', it[i]));
    if (a === 'addblank') it.splice(i, 0, newItem('blank'));
    if (a === 'del') { var x = it.splice(i, 1)[0]; if (!x.isNew) SO.deleted.push(x.label); }
    paintSorter();
  }
  function buildOrdered(text) {
    // fresh units from the (saved) text, matched to sorter items by original index
    var us = units(text), it = SO.items;
    var oldFolio = {}; // folio string -> unit index (old order)
    var pnMatch = 0, pnCount = 0, pad = 2;
    us.forEach(function (u, k) { if (u.pn != null) { pnCount++; if (+u.pn === k) pnMatch++; if (u.pn.length === 1) pad = 1; oldFolio[+u.pn] = k; } });
    var renumber = pnCount && pnMatch / pnCount >= 0.7;
    var newIndexOfOld = {}; it.forEach(function (x, ni) { if (x.u && !x.isNew) newIndexOfOld[x.u.k] = ni; });
    function mapPage(n) { var k = oldFolio[n]; if (k == null || newIndexOfOld[k] == null) return null; return renumber ? newIndexOfOld[k] : null; }
    var fmt = function (n) { return pad === 2 ? String(n).padStart(2, '0') : String(n); };
    // dividers sequential?
    var divs = us.filter(function (u) { return u.divider; }), seq = divs.every(function (u, j) { var m = /<div class="ghost disp">(\d+)<\/div>/.exec(u.html); return m && +m[1] === j + 1; });
    var chunks = [], dn = 0, divNum = {};
    it.forEach(function (x, ni) {
      var src = x.u && !x.isNew ? us[x.u.k] : null;
      var html = src ? src.html : (x.u ? us[x.u.k].html : x.html), gap = src ? src.leadRaw : '';
      if (ni > 0 && !/\S|\n/.test(gap)) gap = (gap.trim() ? gap : '\n\n  ');
      if (ni === 0) gap = gap.trim() ? gap.trim() + '\n  ' : '';
      if (renumber && /<span class="pn">\s*\d+\s*<\/span>/.test(html)) html = html.replace(/<span class="pn">\s*\d+\s*<\/span>/, '<span class="pn">' + fmt(ni) + '</span>');
      if (x.divider) divNum[ni] = dn + 1;
      if (x.divider && seq) { dn++; html = html.replace(/<div class="ghost disp">\d+<\/div>/, '<div class="ghost disp">' + String(dn).padStart(2, '0') + '</div>').replace(/SECTION \d+/, 'SECTION ' + String(dn).padStart(2, '0')); }
      if (renumber) {
        html = html.replace(/(<span class="tp">)(\d+)(<\/span>)/g, function (m0, a, n, z) { var v = mapPage(+n); return v == null ? m0 : a + fmt(v) + z; });
        html = html.replace(/\b(page|pages|p\.)(\s?)(\d+)(\s?[–-]\s?)?(\d+)?/gi, function (m0, w, sp, n1, dash, n2) {
          var v1 = mapPage(+n1); if (v1 == null) return m0;
          var out = w + sp + v1; if (dash && n2) { var v2 = mapPage(+n2); out += dash + (v2 == null ? n2 : v2); } else if (dash) out += dash;
          return out;
        });
      }
      chunks.push(gap + html);
    });
    // contents: keep rows in page order and renumber tn
    chunks = chunks.map(function (c) {
      if (!/class="page toc/.test(c)) return c;
      return c.replace(/(<div class="rows">)([\s\S]*?)(<\/div>\s*<div class="foot)/, function (m0, a, rows, z) {
        var re = /<div class="trow">[\s\S]*?<\/div>/g, slots = [], m;
        while ((m = re.exec(rows))) slots.push({ a: m.index, z: re.lastIndex, r: m[0] });
        if (!slots.length) return m0;
        var srt = slots.map(function (w, j) { var mm = /<span class="tp">(\d+)<\/span>/.exec(w.r); return { r: w.r, tp: mm ? +mm[1] : -1, j: j }; });
        srt.sort(function (p, q) { return p.tp === q.tp ? p.j - q.j : p.tp - q.tp; });
        // a row pointing at a section divider takes that section's number; any other row (e.g. Welcome) is 00
        var outRows = srt.map(function (w) { var n = renumber && divNum[w.tp] != null ? divNum[w.tp] : (renumber ? 0 : null); return n == null ? w.r : w.r.replace(/<span class="tn">\d+<\/span>/, '<span class="tn">' + String(n).padStart(2, '0') + '</span>'); });
        for (var q = slots.length - 1; q >= 0; q--) rows = rows.slice(0, slots[q].a) + outRows[q] + rows.slice(slots[q].z);
        return a + rows + z;
      });
    });
    var first = us[0].start, last = us[us.length - 1].end;
    return { text: text.slice(0, first) + chunks.join('') + text.slice(last), renumber: renumber };
  }
  async function saveOrder() {
    try {
      if (SO.deleted.length && !confirm('Remove these pages from the booklet?\n\n• ' + SO.deleted.join('\n• ') + '\n\nThey stay in your git history if you ever need them back.')) return;
      if (dirtyCount()) { var ok = await save(); if (!ok) return; }
      await ensureDir();
      var disk = await readFile();
      if (disk !== S.src) { toast('This file changed on your Mac since you opened it. Reload and try again so nothing gets overwritten.', 9000, true); return; }
      var out = buildOrdered(S.src);
      await writeFile(out.text);
      try { sessionStorage.setItem('lrs-reenter', '1'); } catch (x) {}
      toast('Saved the new page order' + (out.renumber ? ' and renumbered pages, Contents and page references' : '') + '. Reloading…', 3000);
      setTimeout(function () { location.reload(); }, 700);
    } catch (e) { if (e && e.name === 'AbortError') return; toast('Couldn’t save the order: ' + esc(e.message || String(e)), 8000, true); }
  }
  css += '#lrs-sorter{position:fixed;inset:0;z-index:2147482990;background:#0d0d0e;color:#eee;display:flex;flex-direction:column;font:13px/1.35 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}' +
    '#lrs-sorter .sh{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid #222;flex-wrap:wrap}#lrs-sorter .st1{font-weight:700;font-size:16px}#lrs-sorter .sw{flex:1;display:flex;gap:10px;align-items:center}' +
    '#lrs-sorter .wn{color:#ff8f99;font-weight:600}#lrs-sorter .ok{color:#7fd69a;font-weight:600}#lrs-sorter .sb{display:flex;gap:8px}' +
    '#lrs-sorter button{font:inherit;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;background:#2a2a2a;color:#fff}#lrs-sorter button:hover{background:#3a3a3a}#lrs-sorter button.pri{background:#e01b2f}' +
    '#lrs-sorter .sg{flex:1;overflow:auto;padding:20px;display:flex;flex-wrap:wrap;gap:28px 22px;align-content:flex-start}' +
    '#lrs-sorter .sp{display:flex;gap:0}#lrs-sorter .slot{width:150px;position:relative;cursor:grab}#lrs-sorter .slot.empty{cursor:default}' +
    '#lrs-sorter .th{width:150px;height:150px;position:relative;overflow:hidden;background:#fff;outline:1px solid #333}' +
    '#lrs-sorter .nb{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px}' +
    '#lrs-sorter .cap{margin-top:6px;font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#lrs-sorter .cap b{color:#fff;margin-right:4px}' +
    '#lrs-sorter .act{position:absolute;top:6px;left:6px;right:6px;display:none;gap:4px;justify-content:flex-end}#lrs-sorter .slot:hover .act{display:flex}' +
    '#lrs-sorter .act button{padding:4px 7px;font-size:11px;background:rgba(17,17,17,.88)}' +
    '#lrs-sorter .slot.bad .th{outline:3px solid #e01b2f}#lrs-sorter .pb{font-size:11px;color:#ff8f99;margin-top:3px;width:150px}' +
    '#lrs-sorter .slot.new .th{outline:2px dashed #7fd69a}#lrs-sorter .slot.drag{opacity:.35}' +
    '#lrs-sorter .slot.dropL .th{box-shadow:-5px 0 0 #e01b2f}#lrs-sorter .slot.dropR .th{box-shadow:5px 0 0 #e01b2f}' +
    'html.lrs-sorting{overflow:hidden}html.lrs-sorting #lrs-bar,html.lrs-sorting #lrs-toast{display:none!important}\n';
  /* =====================================================================
     DATA MODE (v1 step 4): pages built from a data list in the file
     (Fall / Spring Group Content). Text on the page is traced back to the
     string in the data list it came from, and saving rewrites that string.
     ===================================================================== */
  function dataRegions(text) {
    var out = [], re = /<script\b[^>]*data-dc-script[^>]*>/g, m;
    while ((m = re.exec(text))) { var a = re.lastIndex, z = text.indexOf('</script>', a); out.push([a, z < 0 ? text.length : z]); }
    return out;
  }
  // JS string literals with exact offsets; skips comments, regexes and ${}-templates
  function jsLiterals(text, a, z) {
    var out = [], i = a, prev = '(';
    while (i < z) {
      var c = text[i];
      if (c === '/' && text[i + 1] === '/') { var nl = text.indexOf('\n', i); i = nl < 0 ? z : nl; continue; }
      if (c === '/' && text[i + 1] === '*') { var ce = text.indexOf('*/', i + 2); i = ce < 0 ? z : ce + 2; continue; }
      if (c === '/' && /[(,=:\[!&|?{};+\-*%<>~^]/.test(prev)) { // regex literal
        var j = i + 1, cls = false;
        while (j < z && text[j] !== '\n') { var d = text[j]; if (d === '\\') { j += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; j++; }
        i = j + 1; while (/[a-z]/i.test(text[i] || '')) i++; prev = '/'; continue;
      }
      if (c === '\'' || c === '"' || c === '`') {
        var s = i + 1, k = s, dyn = false, depth = 0;
        while (k < z) {
          var e = text[k];
          if (e === '\\') { k += 2; continue; }
          if (c === '`' && e === '$' && text[k + 1] === '{') { dyn = true; depth = 1; k += 2; while (k < z && depth) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; } continue; }
          if (e === c) break;
          if (c !== '`' && e === '\n') break;
          k++;
        }
        if (!dyn) out.push({ a: s, z: k, q: c, raw: text.slice(s, k) });
        i = k + 1; prev = 'x'; continue;
      }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return out;
  }
  function unesc(raw) {
    return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|.)/g, function (m, g) {
      if (g[0] === 'u') return String.fromCodePoint(parseInt(g.replace(/[u{}]/g, ''), 16));
      if (g[0] === 'x') return String.fromCharCode(parseInt(g.slice(1), 16));
      return { n: '\n', t: '\t', r: '\r', '\n': '', '\r\n': '' }[g] != null ? { n: '\n', t: '\t', r: '\r', '\n': '', '\r\n': '' }[g] : g;
    });
  }
  function enc(v, q) {
    v = v.replace(/\\/g, '\\\\');
    if (q === '`') return v.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return v.replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n');
  }
  function buildLitMap(text) {
    var lits = [];
    dataRegions(text).forEach(function (r) { lits = lits.concat(jsLiterals(text, r[0], r[1])); });
    var byText = {};
    lits.forEach(function (l) { l.val = unesc(l.raw); var k = norm(l.val); if (k.length < 3 || !/[A-Za-z]/.test(k)) return; (byText[k] = byText[k] || []).push(l); });
    var blocks = [], used = new Set();
    function uniq(t) { var L = byText[t]; return L && L.length === 1 ? L[0] : null; }
    (function walk(el) {
      var tg = el.tagName.toLowerCase();
      if (SKIP_TAGS.test(tg) || SKIP_CLASS.test(typeof el.className === 'string' ? el.className : '') || el.id === 'lrs-bar' || el.id === 'lrs-sorter') return;
      var t = norm(el.textContent), lit = t && uniq(t);
      if (lit && tg !== 'body') {
        var deeper = Array.prototype.some.call(el.children, function (ch) { return norm(ch.textContent) === t; });
        if (!deeper) { blocks.push({ kind: 'lit', el: el, lit: lit, orig: el.innerText }); return; }
      }
      Array.prototype.slice.call(el.children).forEach(walk);
      Array.prototype.slice.call(el.childNodes).forEach(function (n) {
        if (n.nodeType !== 3) return; var tl = uniq(norm(n.data)); if (!tl || norm(el.textContent) === norm(n.data)) return;
        var sp = document.createElement('span'); sp.className = 'lrs-wrap'; el.insertBefore(sp, n); sp.appendChild(n);
        blocks.push({ kind: 'lit', el: sp, lit: tl, orig: sp.innerText });
      });
    })(document.body);
    // static text typed straight into the page template (headings, Start Up copy): unique on screen + unique in the file
    var root = parse(text), A = srcAdapter(text), body = null;
    (function f(nd) { nd.children.forEach(function (c) { if (body) return; if (c.tag === 'body') body = c; else f(c); }); })(root);
    var sb = [], lb = [], sc = {}, lc = {};
    collect(A, body || root, sb); collect(liveAdapter, document.body, lb);
    sb = sb.filter(function (s) { return text.slice(s.innerStart, s.innerEnd).indexOf('{{') < 0; });
    sb.forEach(function (s) { var k = norm(A.text(s)); (sc[k] = sc[k] || []).push(s); });
    var litEls = blocks.map(function (b) { return b.el; });
    lb = lb.filter(function (el) { return !litEls.some(function (x) { return x === el || x.contains(el) || el.contains(x); }); });
    lb.forEach(function (el) { var k = norm(el.textContent); lc[k] = (lc[k] || 0) + 1; });
    lb.forEach(function (el) {
      var k = norm(el.textContent), s = sc[k];
      if (s && s.length === 1 && lc[k] === 1 && !byText[k]) blocks.push({ el: el, src: s[0], orig: el.innerHTML, srcInner: text.slice(s[0].innerStart, s[0].innerEnd) });
    });
    return { blocks: blocks, miss: 0 };
  }
  function litVal(b) { var v = (b.val != null ? b.val : b.el.innerText); return v.replace(/\n+$/, ''); }
  function litDirty(b) { return norm(litVal(b)) !== norm(b.orig); }
  function serializeLits() {
    var by = new Map();
    S.blocks.forEach(function (b) { if (b.kind === 'lit' && litDirty(b)) by.set(b.lit, litVal(b)); });
    var edits = []; by.forEach(function (v, l) { edits.push({ a: l.a, z: l.z, html: enc(v, l.q) }); });
    S.blocks.forEach(function (b) { if (b.kind !== 'lit' && b.el.innerHTML !== b.orig) edits.push({ a: b.src.innerStart, z: b.src.innerEnd, html: clean(b.el.innerHTML, b.srcInner) }); });
    edits.sort(function (x, y) { return y.a - x.a; });
    var t = S.src; edits.forEach(function (e) { t = t.slice(0, e.a) + e.html + t.slice(e.z); });
    return { text: t, count: edits.length };
  }

  /* ---------- series / week order for data pages ---------- */
  function scanTo(text, i, z, stopChars) { // walk JS from i, skipping strings/comments, until a char in stopChars at depth 0
    var depth = 0;
    while (i < z) {
      var c = text[i];
      if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return z; continue; }
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 2; continue; }
      if (c === '\'' || c === '"' || c === '`') { var k = i + 1; while (k < z && text[k] !== c) { if (text[k] === '\\') k++; k++; } i = k + 1; continue; }
      if (depth === 0 && stopChars.indexOf(c) >= 0) return i;
      if (c === '[' || c === '{' || c === '(') depth++; else if (c === ']' || c === '}' || c === ')') depth--;
      i++;
    }
    return z;
  }
  function arrayItems(text, open) { // open = index of '['
    var items = [], i = open + 1, end;
    while (true) {
      while (/[\s,]/.test(text[i])) i++;
      while (text.startsWith('//', i)) { i = text.indexOf('\n', i) + 1; while (/[\s,]/.test(text[i])) i++; }
      if (text[i] === ']') { end = i; break; }
      var e = scanTo(text, i, text.length, ',]'); var ee = e; while (/\s/.test(text[ee - 1])) ee--;
      items.push({ a: i, z: ee }); i = e; if (text[e] === ']') { end = e; break; }
    }
    return { items: items, end: end };
  }
  function firstLit(text, a, z, key) {
    var m = new RegExp('\\b' + key + '\\s*:\\s*([`\'"])').exec(text.slice(a, z)); if (!m) return '';
    var s = a + m.index + m[0].length, k = s; while (k < z && text[k] !== m[1]) { if (text[k] === '\\') k++; k++; } return unesc(text.slice(s, k));
  }
  function dataModel(text) {
    var r = dataRegions(text)[0]; if (!r) return null;
    var m = /const\s+raw\s*=\s*\[/.exec(text.slice(r[0], r[1])); if (!m) return null;
    var open = r[0] + m.index + m[0].length - 1, arr = arrayItems(text, open);
    return arr.items.map(function (it) {
      var seg = text.slice(it.a, it.z), wm = /\bweeks\s*:\s*\[/.exec(seg), weeks = [];
      if (wm) { var wo = it.a + wm.index + wm[0].length - 1; weeks = arrayItems(text, wo).items.map(function (w) { return { a: w.a, z: w.z, t: firstLit(text, w.a, w.z, 't'), track: firstLit(text, w.a, w.z, 'track') }; }); }
      return { a: it.a, z: it.z, title: firstLit(text, it.a, it.z, 'title') || '(untitled)', weeks: weeks };
    });
  }
  function permuteSlots(text, slots, order) { // slots: [{a,z}] in file order; order: new list of slot indexes
    var out = text, pieces = order.map(function (k) { return text.slice(slots[k].a, slots[k].z); });
    for (var i = slots.length - 1; i >= 0; i--) out = out.slice(0, slots[i].a) + pieces[i] + out.slice(slots[i].z);
    return out;
  }
  var DM = null;
  function openSeries() {
    var model = dataModel(S.src);
    if (!model) { toast('Couldn’t find the series list in this file.', 6000, true); return; }
    DM = { model: model, order: model.map(function (_, i) { return i; }), weeks: model.map(function (s) { return s.weeks.map(function (_, i) { return i; }); }) };
    var ov = document.createElement('div'); ov.id = 'lrs-sorter'; ov.className = 'lrs-ui lrs-series';
    ov.innerHTML = '<div class="sh"><div class="st1">Series &amp; weeks</div><div class="sw"><span class="ok">Use the arrows to reorder. Page numbers, Contents and tips follow automatically.</span></div><div class="sb"><button data-d="cancel">Cancel</button><button class="pri" data-d="save">Save order</button></div></div><div class="sl"></div>';
    document.body.appendChild(ov); document.documentElement.classList.add('lrs-sorting');
    ov.addEventListener('click', seriesClick); paintSeries();
  }
  function paintSeries() {
    var box = document.querySelector('#lrs-sorter .sl'); if (!box) return;
    box.innerHTML = DM.order.map(function (si, pos) {
      var s = DM.model[si];
      return '<div class="srow"><div class="shd"><b>' + (pos + 1) + '</b><span>' + esc(s.title) + '</span><span class="sar"><button data-d="up" data-p="' + pos + '"' + (pos ? '' : ' disabled') + '>↑</button><button data-d="dn" data-p="' + pos + '"' + (pos < DM.order.length - 1 ? '' : ' disabled') + '>↓</button></span></div>' +
        '<div class="wks">' + DM.weeks[si].map(function (wi, wp) { var w = s.weeks[wi]; return '<div class="wrow"><span>' + (w.track ? esc(w.track) + ' · ' : '') + esc(w.t || ('Week ' + (wi + 1))) + '</span><span class="sar"><button data-d="wup" data-s="' + si + '" data-p="' + wp + '"' + (wp ? '' : ' disabled') + '>↑</button><button data-d="wdn" data-s="' + si + '" data-p="' + wp + '"' + (wp < DM.weeks[si].length - 1 ? '' : ' disabled') + '>↓</button></span></div>'; }).join('') + '</div></div>';
    }).join('');
  }
  function swap(a, i, j) { var t = a[i]; a[i] = a[j]; a[j] = t; }
  function seriesClick(e) {
    var b = e.target.closest('[data-d]'); if (!b || b.disabled) return;
    var d = b.getAttribute('data-d'), p = +b.getAttribute('data-p'), si = +b.getAttribute('data-s');
    if (d === 'cancel') { closeSorter(); DM = null; return; }
    if (d === 'save') { saveSeries(); return; }
    if (d === 'up') swap(DM.order, p, p - 1); if (d === 'dn') swap(DM.order, p, p + 1);
    if (d === 'wup') swap(DM.weeks[si], p, p - 1); if (d === 'wdn') swap(DM.weeks[si], p, p + 1);
    paintSeries();
  }
  function seriesText(src, order, weeks) {
    var model = dataModel(src), t = src;
    // weeks inside each series first (later series first so offsets stay valid), then the series themselves
    for (var si = model.length - 1; si >= 0; si--) {
      var ord = weeks[si]; if (ord.every(function (v, i) { return v === i; })) continue;
      t = permuteSlots(t, model[si].weeks, ord);
    }
    model = dataModel(t);
    if (!order.every(function (v, i) { return v === i; })) t = permuteSlots(t, model, order);
    return t;
  }
  async function saveSeries() {
    try {
      if (dirtyCount()) { var ok = await save(); if (!ok) return; }
      await ensureDir(); var disk = await readFile();
      if (disk !== S.src) { toast('This file changed on your Mac since you opened it. Reload and try again.', 9000, true); return; }
      var t = seriesText(S.src, DM.order, DM.weeks);
      if (t === S.src) { toast('Nothing moved.'); return; }
      await writeFile(t);
      try { sessionStorage.setItem('lrs-reenter', '1'); } catch (x) {}
      toast('Saved the new order. Reloading…', 3000); setTimeout(function () { location.reload(); }, 700);
    } catch (e) { if (e && e.name === 'AbortError') return; toast('Couldn’t save the order: ' + esc(e.message || String(e)), 8000, true); }
  }
  css += '#lrs-sorter.lrs-series .sl{flex:1;overflow:auto;padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;align-content:start}' +
    '#lrs-sorter .srow{background:#17171a;border:1px solid #2a2a2e;border-radius:12px;padding:12px}#lrs-sorter .shd{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600}#lrs-sorter .shd b{color:#e01b2f}' +
    '#lrs-sorter .sar{margin-left:auto;display:flex;gap:4px}#lrs-sorter .sar button{padding:4px 9px}#lrs-sorter .sar button:disabled{opacity:.3;cursor:default}' +
    '#lrs-sorter .wks{margin-top:10px;display:flex;flex-direction:column;gap:4px}#lrs-sorter .wrow{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#202024;border-radius:8px;font-size:13px;color:#ccc}\n';
  function render() {
    if (!S.ui) {
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      S.ui = document.createElement('div'); S.ui.id = 'lrs-bar'; S.ui.className = 'lrs-ui'; document.body.appendChild(S.ui);
      S.ui.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act');
        if (a === 'edit') enable(); else if (a === 'done') disable(); else if (a === 'save') save(); else if (a === 'pages') { if (S.data) openSeries(); else openSorter(); }
        else if (a === 'next' && S.over && S.over.length) { S.oi = ((S.oi || 0) + 1) % S.over.length; S.over[S.oi].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    }
    if (!S.on) { S.ui.innerHTML = '<button data-act="edit" title="Edit text (E)">✎ Edit text</button>'; return; }
    var c = dirtyCount(), o = (S.over || []).length;
    S.ui.innerHTML = (o ? '<span class="st warn" data-act="next" title="Jump to the next overflowing page">⚠ ' + o + ' page' + (o > 1 ? 's' : '') + ' overflowing</span>' : '') +
      '<span class="st">' + (c ? c + ' unsaved change' + (c > 1 ? 's' : '') : 'No changes') + '</span>' +
      '<button data-act="pages" title="Rearrange pages">' + (S.data ? '\u25a6 Series' : '\u25a6 Pages') + '</button><button class="pri" data-act="save"' + (c ? '' : ' disabled') + ' title="Save (⌘S)">Save</button><button data-act="done" title="Leave edit mode (E)">Done</button>';
  }
  var tt = 0;
  function toast(html, ms, err) {
    var el = document.getElementById('lrs-toast');
    if (!el) { el = document.createElement('div'); el.id = 'lrs-toast'; el.className = 'lrs-ui'; document.body.appendChild(el); }
    el.innerHTML = html; el.classList.toggle('err', !!err); el.style.display = 'block';
    clearTimeout(tt); tt = setTimeout(function () { el.style.display = 'none'; }, ms || 3000);
  }

  window.LRSEdit = { _merge: mergeOnto, openSorter: openSorter, _dataModel: dataModel, _seriesText: seriesText, openSeries: openSeries, _units: units, _SO: function () { return SO; }, _buildOrdered: function (t) { return buildOrdered(t); }, _problems: function () { return problems(); }, _move: movePages, _fix: applyFix, enable: enable, disable: disable, save: save, _serialize: serialize, _parse: parse, _state: S, _check: checkOverflow };
  function boot() { render(); var re = false; try { re = sessionStorage.getItem('lrs-reenter') === '1'; sessionStorage.removeItem('lrs-reenter'); } catch (x) {}
    if (re) loadDir().then(function (h) { if (!h) return; return h.queryPermission({ mode: 'readwrite' }).then(function (p) { if (p === 'granted') { S.dir = h; enable(); } }); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
