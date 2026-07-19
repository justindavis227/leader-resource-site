/* Print-ready launcher for the Southeast Students library.
   Trigger with ?print=1 or #print — now redirects to the pre-rendered PDF.

   Booklets (.page = 8in square trim) — legacy crop-mark machinery kept below
   for manual printing paths.

   Further-resource sheets (.rpage = 8.5x11): plain full-page print, no marks. */
/* ── Always-on for further-resource sheets (.rpage = 8.5x11) ──────────────
   1. Give every resource a correct print page box (US Letter, zero margins)
      so a plain Cmd/Ctrl+P — or the iOS share-sheet Print — lays each sheet
      out true to size on ONE page instead of bleeding onto two.
   2. Scale the fixed 816px sheet down to fit narrow (mobile) viewports.
      Uses transform:scale inside a size-reserving wrapper (CSS `zoom` is
      unreliable on iOS Safari and left the footer overlapping content).    */
(function () {
  function injectResourcePrintPage() {
    if (!document.querySelector('.rpage') || document.getElementById('__rpage_print')) return;
    var st = document.createElement('style');
    st.id = '__rpage_print';
    st.setAttribute('media', 'print');
    st.textContent =
      '@page{size:letter;margin:0}' +
      'html,body{background:#fff!important;margin:0!important;padding:0!important;' +
        '-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
      '.rpage-fit{display:block!important;width:auto!important;height:auto!important;margin:0!important;overflow:visible!important}' +
      '.rpage{box-shadow:none!important;zoom:1!important;transform:none!important;transform-origin:top left!important;break-after:page;page-break-after:always}' +
      '.rpage:last-of-type{break-after:auto;page-break-after:auto}';
    document.head.appendChild(st);
  }
  function fitMobile() {
    var pages = document.querySelectorAll('.rpage');
    if (!pages.length) return;
    var vw = document.documentElement.clientWidth;
    var scale = vw < 840 ? Math.min(1, (vw - 16) / 816) : 1;
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      p.style.zoom = '';
      var wrap = (p.parentNode && p.parentNode.className === 'rpage-fit') ? p.parentNode : null;
      if (scale < 1) {
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'rpage-fit';
          p.parentNode.insertBefore(wrap, p);
          wrap.appendChild(p);
        }
        wrap.style.cssText = 'width:' + Math.round(816 * scale) + 'px;height:' +
          Math.round(1056 * scale) + 'px;margin:0 auto;overflow:hidden';
        p.style.transformOrigin = 'top left';
        p.style.transform = 'scale(' + scale + ')';
      } else {
        if (wrap) {
          wrap.parentNode.insertBefore(p, wrap);
          wrap.parentNode.removeChild(wrap);
        }
        p.style.transform = '';
        p.style.transformOrigin = '';
      }
    }
  }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () { injectResourcePrintPage(); fitMobile(); });
  window.addEventListener('resize', fitMobile);
  window.addEventListener('orientationchange', fitMobile);
})();

(function () {
  if (!/[?&]print(=|&|$)/.test(location.search) && !/(^|[#&])print($|&|=)/.test(location.hash)) return;

  /* PDF launcher: serve the pre-rendered true-size PDF (clean, no browser chrome) instead of window.print(). */
  window.location.replace("/pdf/" + encodeURIComponent(decodeURIComponent(location.pathname).replace(/^.*\//,"").replace(/\.html$/i,".pdf")));
  return;

  var isBooklet = false;
  var wrapped = [];

  function injectStyle() {
    var st = document.createElement('style');
    st.setAttribute('media', 'print');
    st.id = '__printmarks_style';
    if (isBooklet) {
      st.textContent =
        '@page{size:8.4in 8.4in;margin:0}' +
        'html,body{background:#fff!important;margin:0!important;padding:0!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '#libnav,.toolbar,.viewbar,#tweak-root{display:none!important}' +
        '.stage,.se-stage{display:block!important;width:auto!important;height:auto!important;transform:none!important;overflow:visible!important}' +
        '.stack,.stack.spread,.book,.spread{display:block!important;width:auto!important;margin:0!important;gap:0!important;transform:none!important}' +
        '.pair,.stack.spread .pair,.stack.spread .pair.lead{display:contents!important;width:auto!important;transform:none!important}' +
        '.page,.pg{width:8in!important;height:8in!important;box-shadow:none!important;border-radius:0!important;transform:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '.page *,.pg *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '[class$="-arc"]{stroke-dashoffset:0!important;animation:none!important}' +
        '[class$="-node"]{opacity:1!important;transform:none!important;animation:none!important}' +
        '[class$="-bey"]{opacity:1!important;animation:none!important}' +
        '.cropsheet{position:relative;width:8.4in;height:8.4in;display:flex;align-items:center;justify-content:center;overflow:visible;background:#fff;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}' +
        '.cropsheet:last-of-type{break-after:auto;page-break-after:auto}' +
        '.trimbox{position:relative;width:8in;height:8in;overflow:visible}' +
        '.cropmark{position:absolute;background:#111}';
    } else {
      st.textContent =
        '@page{size:letter;margin:0}' +
        'html,body{background:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '#libnav{display:none!important}' +
        '.rpage,.rpage *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '.rpage{box-shadow:none!important}';
    }
    document.head.appendChild(st);
  }

  function build() {
    if (!isBooklet || wrapped.length) return;
    var GAP = '0.06in';
    var NEG = '-0.18in';
    var FAR = 'calc(100% + 0.06in)';
    var BR  = 'calc(100% - 0.75px)';
    var L = '0.12in', T = '0.75px';
    var specs = [
      [NEG, '0', L, T], [FAR, '0', L, T],
      [NEG, BR, L, T],  [FAR, BR, L, T],
      ['0', NEG, T, L], [BR, NEG, T, L],
      ['0', FAR, T, L], [BR, FAR, T, L]
    ];
    var pages = [].slice.call(document.querySelectorAll('.page,.pg'));
    pages.forEach(function (p) {
      var sheet = document.createElement('div');
      sheet.className = 'cropsheet';
      var trim = document.createElement('div');
      trim.className = 'trimbox';
      p.parentNode.insertBefore(sheet, p);
      trim.appendChild(p);
      sheet.appendChild(trim);
      specs.forEach(function (s) {
        var m = document.createElement('div');
        m.className = 'cropmark';
        m.style.cssText = 'left:' + s[0] + ';top:' + s[1] + ';width:' + s[2] + ';height:' + s[3] + ';';
        trim.appendChild(m);
      });
      wrapped.push({ sheet: sheet, page: p });
    });
  }

  function teardown() {
    wrapped.forEach(function (w) {
      w.sheet.parentNode.insertBefore(w.page, w.sheet);
      w.sheet.remove();
    });
    wrapped = [];
  }

  window.addEventListener('beforeprint', build);
  window.addEventListener('afterprint', teardown);

  function start() {
    var tries = 0;
    (function poll() {
      var pg = document.querySelector('.page,.pg');
      var rp = document.querySelector('.rpage');
      if (pg || rp) {
        isBooklet = !!pg;
        injectStyle();
        setTimeout(function () { window.print(); }, 900);
        return;
      }
      if (++tries < 100) setTimeout(poll, 150);
    })();
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
