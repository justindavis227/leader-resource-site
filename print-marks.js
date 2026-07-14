/* Print-ready launcher for the Southeast Students library.
   Trigger with ?print=1 or #print and the doc prints itself.

   Booklets (.page = 8in square trim) — Canva-style crop marks:
     - The artwork prints at its true 8in size (NOT scaled, NOT bled). The
       print shop trims to whatever stock they like.
     - The PDF page is the 8in design plus a thin 0.2in margin that exists
       only to hold the trim marks; eight corner ticks sit just outside the
       artwork, exactly like a Canva "crop marks" export.
     - The Spreads view + its fit-to-window zoom are collapsed to a clean
       one-page-per-sheet flow, and every entrance animation (the campus-map
       arcs / nodes / arrows) is forced to its finished state so nothing is
       captured mid-animation.
     - print-color-adjust:exact keeps the dark covers and colour fills.

   Further-resource sheets (.rpage = 8.5x11): plain full-page print, no marks.

   All DOM wrapping happens on beforeprint and is undone on afterprint, so the
   on-screen view is never disturbed. */
(function () {
  // Trigger on ?print=1 OR #print. The hash form survives the preview's
  // link-rewriting (which only recognises the bare filename and would drop a
  // ?print= query, leaving the served page without its required token).
  if (!/[?&]print(=|&|$)/.test(location.search) && !/(^|[#&])print($|&|=)/.test(location.hash)) return;

  var isBooklet = false; // decided once the document's pages exist (DC booklets mount late)
  var wrapped = [];

  function injectStyle() {
    var st = document.createElement('style');
    st.setAttribute('media', 'print');
    st.id = '__printmarks_style';
    if (isBooklet) {
      st.textContent =
        // 8in design + 0.2in margin all round for the trim marks
        '@page{size:8.4in 8.4in;margin:0}' +
        'html,body{background:#fff!important;margin:0!important;padding:0!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '#libnav,.toolbar,.viewbar,#tweak-root{display:none!important}' +
        // collapse the Spreads machinery: linear block flow, no scaling
        '.stage,.se-stage{display:block!important;width:auto!important;height:auto!important;transform:none!important;overflow:visible!important}' +
        '.stack,.stack.spread,.book,.spread{display:block!important;width:auto!important;margin:0!important;gap:0!important;transform:none!important}' +
        '.pair,.stack.spread .pair,.stack.spread .pair.lead{display:contents!important;width:auto!important;transform:none!important}' +
        // artwork at true size — no scale, no bleed
        '.page,.pg{width:8in!important;height:8in!important;box-shadow:none!important;border-radius:0!important;transform:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        '.page *,.pg *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' +
        // freeze every entrance animation at its finished frame (campus map etc.)
        '[class$="-arc"]{stroke-dashoffset:0!important;animation:none!important}' +
        '[class$="-node"]{opacity:1!important;transform:none!important;animation:none!important}' +
        '[class$="-bey"]{opacity:1!important;animation:none!important}' +
        // sheet = design + margin; trim box = the 8in page; marks ride the trim box
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
    // Marks ride the 8in trim box: a 0.06in gap off the trim edge, then a
    // 0.12in tick — all inside the 0.2in sheet margin.
    var GAP = '0.06in';                           // gap: trim edge -> tick start
    var NEG = '-0.18in';                          // tick start off the near edge (0.06 + 0.12)
    var FAR = 'calc(100% + 0.06in)';              // tick start off the far edge
    var BR  = 'calc(100% - 0.75px)';              // align a thin tick to the far trim line
    var L = '0.12in', T = '0.75px';               // tick length / thickness
    // [left, top, width, height]
    var specs = [
      // horizontal ticks (top & bottom trim lines)
      [NEG, '0', L, T], [FAR, '0', L, T],
      [NEG, BR, L, T],  [FAR, BR, L, T],
      // vertical ticks (left & right trim lines)
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

  // Wait until the page frames actually exist before sizing the sheet.
  // DC-runtime booklets mount their .page sections well after load; deciding
  // early sent them down the letter (8.5x11) path with blank margins.
  function start() {
    var tries = 0;
    (function poll() {
      var pg = document.querySelector('.page,.pg');
      var rp = document.querySelector('.rpage');
      if (pg || rp) {
        isBooklet = !!pg;
        injectStyle();
        // give React / the campus-map SVG a beat to settle before printing
        setTimeout(function () { window.print(); }, 900);
        return;
      }
      if (++tries < 100) setTimeout(poll, 150); // keep trying ~15s
    })();
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
