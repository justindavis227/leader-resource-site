/* LRS Fit: keeps a booklet the same size on screen no matter how far the browser is zoomed.
   The booklet always fills the window width. It is scaled with a transform
   sized from the window's CSS width, so browser zoom cancels out to the same on-screen size.
   It also sets the booklet in the brand face on screen, matching print. Print / PDF output is untouched. */
(function () {
  'use strict';
  if (window.__lrsFit) return; window.__lrsFit = true;
  // Booklets are print pieces: on screen they use the brand face throughout, exactly like the PDF build,
  // so text wraps the same on screen as on paper (the system font is wider and pushed text into footers).
  var ft = document.createElement('style');
  ft.textContent = ':root{--font-body:var(--font-print)!important;--font-mono:var(--font-print)!important}';
  (document.head || document.documentElement).appendChild(ft);
  if (navigator.webdriver || location.hostname === 'lrs.local' || /(^|[#&])print\b/.test(location.hash)) return; // PDF renderer + print mode lay out at true size

  var st = document.createElement('style');
  st.textContent = '@media print{#stack,.se-stage .book{zoom:1!important;transform:none!important;width:auto!important;margin:0!important}#stage,.se-stage{height:auto!important}}';
  (document.head || document.documentElement).appendChild(st);

  function target() {
    var stage = document.getElementById('stage'), stack = document.getElementById('stack');
    if (stage && stack) return { stage: stage, el: stack, base: stack.classList.contains('spread') ? 1536 : 768 };
    var ss = document.querySelector('.se-stage'), book = ss && ss.querySelector('.book');
    if (ss && book) {
      var sp = book.querySelector('.spread');
      return { stage: ss, el: book, base: sp && getComputedStyle(sp).flexDirection === 'row' ? 1552 : 768 };
    }
    return null;
  }

  var busy = false, last = '';
  function fit() {
    if (busy) return;
    var t = target(); if (!t) return;
    var sw = t.stage.clientWidth; if (!sw) return;
    var s = Math.max(0.05, (sw - 32) / t.base);
    busy = true;
    var e = t.el.style;
    // Scale with a transform, not CSS `zoom`: Safari enforces its minimum font size on zoomed text,
    // which enlarged small type in narrow windows and pushed text into footers.
    if (e.zoom) e.zoom = '';
    if (e.width !== t.base + 'px') e.width = t.base + 'px';
    if (e.transformOrigin !== 'left top') e.transformOrigin = 'left top';
    var tr = 'scale(' + (Math.round(s * 10000) / 10000) + ')';
    if (e.transform !== tr) e.transform = tr;
    var ml = Math.max(0, Math.round((sw - t.base * s) / 2)) + 'px';
    if (e.marginLeft !== ml) { e.marginLeft = ml; e.marginRight = '0'; }
    var h = Math.ceil(t.el.offsetHeight * s) + 'px';
    if (t.stage.style.height !== h) t.stage.style.height = h;
    last = tr;
    busy = false;
  }

  // The pages' own sizing code also runs on resize/load/view changes; re-apply after it.
  function soon() { requestAnimationFrame(fit); setTimeout(fit, 60); }
  window.addEventListener('resize', soon);
  window.addEventListener('load', soon);
  document.addEventListener('click', soon, true);
  var mo = new MutationObserver(function () { if (!busy) soon(); });
  function watch() {
    var t = target(); if (!t) return false;
    mo.observe(t.el, { attributes: true, attributeFilter: ['style', 'class'] });
    mo.observe(t.stage, { attributes: true, attributeFilter: ['style'] });
    fit(); return true;
  }
  // data-built booklets render a moment after load
  (function wait(n) { if (!watch() && n < 60) setTimeout(function () { wait(n + 1); }, 100); })(0);
  [0, 300, 1000].forEach(function (ms) { setTimeout(fit, ms); });
})();
