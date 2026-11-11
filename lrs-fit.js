/* LRS Fit: keeps a booklet the same size on screen no matter how far the browser is zoomed.
   The booklet always fills the window width. It is scaled with CSS `zoom` (not a transform),
   so the browser's own zoom and ours multiply out to the same on-screen size. That also keeps
   Safari from enlarging small text when someone zooms out (its minimum font size never kicks in).
   Print / PDF output is untouched. */
(function () {
  'use strict';
  if (window.__lrsFit) return; window.__lrsFit = true;
  if (navigator.webdriver || location.hostname === 'lrs.local' || /(^|[#&])print\b/.test(location.hash)) return; // PDF renderer + print mode lay out at true size

  var st = document.createElement('style');
  st.textContent = '@media print{#stack,.se-stage .book{zoom:1!important;width:auto!important}}';
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
    if (e.transform && e.transform !== 'none') e.transform = 'none';
    if (e.width !== t.base + 'px') e.width = t.base + 'px';
    if (e.marginLeft !== 'auto') { e.marginLeft = 'auto'; e.marginRight = 'auto'; }
    var z = String(Math.round(s * 10000) / 10000);
    if (e.zoom !== z) e.zoom = z;
    if (t.stage.style.height) t.stage.style.height = '';
    last = z;
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
