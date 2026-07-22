/* ============================================================
   Southeast Christian — Campus Vision Map renderer
   Geographically-projected "constellation" of all campuses,
   radiating from Blankenbaker (origin). Pure SVG, no deps.
   CampusMap.render(hostEl, opts)
   ============================================================ */
(function () {
  // Positions are projected from real lat/long (equirectangular,
  // centered on Blankenbaker) into the 768x768 booklet frame.
  // Franklin TN is the far-south outlier, compressed to sit near the
  // bottom edge as the "and beyond" anchor.
  const C = [
    { n: 'Blankenbaker',        s: 'Blankenbaker',     x: 372, y: 250, t: 'origin' },
    { n: 'Chapel in the Woods', s: 'Multi-Nation',     x: 351, y: 236, t: 'metro' },
    { n: 'South Louisville',    s: 'South Louisville', x: 296, y: 262, t: 'metro' },
    { n: 'Beechmont Center',    s: 'Beechmont',        x: 300, y: 278, t: 'metro' },
    { n: 'Southwest',           s: 'Southwest',        x: 272, y: 292, t: 'metro' },
    { n: 'Indiana',             s: 'Indiana',          x: 303, y: 206, t: 'regional' },
    { n: 'Prospect',            s: 'Prospect',         x: 356, y: 182, t: 'regional' },
    { n: 'Crestwood',           s: 'Crestwood',        x: 401, y: 198, t: 'regional' },
    { n: 'La Grange',           s: 'La Grange',        x: 431, y: 171, t: 'regional' },
    { n: 'Shelby County',       s: 'Shelby County',    x: 476, y: 256, t: 'regional' },
    { n: 'Bullitt County',      s: 'Bullitt County',   x: 366, y: 338, t: 'regional' },
    { n: 'Nelson County',       s: 'Nelson County',    x: 412, y: 434, t: 'regional' },
    { n: 'Elizabethtown',       s: 'Elizabethtown',    x: 260, y: 480, t: 'regional' },
    { n: 'Franklin',            s: 'Franklin, TN',     x: 300, y: 694, t: 'beyond' },
  ];

  // Explicit label anchors so dense Louisville metro doesn't collide.
  // a = text-anchor; metro pins are pulled into a tidy left-side stack
  // with leader lines.
  const LBL = {
    'Blankenbaker':        { lx: 408, ly: 300, a: 'start', big: true },
    'Chapel in the Woods': { lx: 351, ly: 219, a: 'middle', sm: true },
    'South Louisville':    { lx: 150, ly: 250, a: 'end', lead: true },
    'Beechmont Center':    { lx: 150, ly: 272, a: 'end', lead: true },
    'Southwest':           { lx: 150, ly: 294, a: 'end', lead: true },
    'Indiana':             { lx: 292, ly: 192, a: 'end' },
    'Prospect':            { lx: 356, ly: 165, a: 'middle' },
    'Crestwood':           { lx: 416, ly: 192, a: 'start' },
    'La Grange':           { lx: 446, ly: 168, a: 'start' },
    'Shelby County':       { lx: 496, ly: 250, a: 'start' },
    'Bullitt County':      { lx: 382, ly: 346, a: 'start' },
    'Nelson County':       { lx: 428, ly: 440, a: 'start' },
    'Elizabethtown':       { lx: 244, ly: 486, a: 'end' },
    'Franklin':            { lx: 320, ly: 690, a: 'start', beyond: true },
  };

  const EMBER = '#eb6424', SOLAR = '#e8d136', FIRE = '#cc3f36',
        SLATE = '#fffef9', COOL = '#1a9cd6';

  function arcPath(x1, y1, x2, y2, k) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const cx = mx + nx * k, cy = my + ny * k;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  CampusMap = window.CampusMap = {
    DATA: C,
    render: function (host, opts) {
      opts = opts || {};
      const W = opts.width || 768, H = opts.height || 768;
      const o = C[0]; // origin = Blankenbaker
      const cfg = Object.assign({
        vignette: true, grid: 'dots', rings: false, river: false,
        compass: false, network: false, pin: 'glow', arc: 'solid',
        beyond: 'arrows', accent: EMBER, labels: 'all', headline: 'corner',
        shiftY: 34, offsetX: 0, scale: 1, beyondAngles: null,
      }, opts.cfg || {});

      const uid = 'm' + Math.random().toString(36).slice(2, 7);
      const A = cfg.accent;
      const anim = cfg.animate !== false;        // set animate:false to skip entrance anim (e.g. live tweak re-renders)
      const clsArc = anim ? uid + '-arc' : '';
      const clsNode = anim ? uid + '-node' : '';
      const clsBey = anim ? uid + '-bey' : '';
      const clsBeyHead = anim ? uid + '-beyhead' : '';
      let defs = '', bg = '', grid = '', extras = '', arcs = '', beyond = '', nodes = '', labels = '';

      // ---- defs: gradients + filters ----
      defs += `
        <radialGradient id="${uid}-vig" cx="48%" cy="36%" r="75%">
          <stop offset="0%" stop-color="#141b21"/>
          <stop offset="55%" stop-color="#0e1418"/>
          <stop offset="100%" stop-color="#080b0e"/>
        </radialGradient>
        <radialGradient id="${uid}-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${SOLAR}"/>
          <stop offset="38%" stop-color="${A}"/>
          <stop offset="100%" stop-color="${A}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${uid}-dot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${SLATE}"/>
          <stop offset="45%" stop-color="${A}"/>
          <stop offset="100%" stop-color="${A}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="${uid}-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${SOLAR}" stop-opacity="1"/>
          <stop offset="22%" stop-color="${A}" stop-opacity=".95"/>
          <stop offset="100%" stop-color="${A}" stop-opacity=".42"/>
        </linearGradient>
        <linearGradient id="${uid}-bey" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${A}"/>
          <stop offset="100%" stop-color="${A}" stop-opacity="0"/>
        </linearGradient>
        <filter id="${uid}-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>`;

      // ---- background ----
      bg = cfg.transparent ? ''
        : cfg.vignette
        ? `<rect width="${W}" height="${H}" fill="url(#${uid}-vig)"/>`
        : `<rect width="${W}" height="${H}" fill="#0e1418"/>`;

      // ---- grid ----
      if (cfg.grid === 'dots') {
        let d = '';
        for (let gx = 24; gx < W; gx += 32)
          for (let gy = 24; gy < H; gy += 32)
            d += `<circle cx="${gx}" cy="${gy}" r="1" fill="${SLATE}" opacity=".05"/>`;
        grid = d;
      } else if (cfg.grid === 'graticule') {
        let g = '';
        for (let gx = 96; gx < W; gx += 96) g += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="${SLATE}" stroke-opacity=".045"/>`;
        for (let gy = 96; gy < H; gy += 96) g += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="${SLATE}" stroke-opacity=".045"/>`;
        grid = g;
      }

      // ---- shockwave rings ----
      if (cfg.rings) {
        for (let i = 1; i <= 5; i++) {
          const r = i * 92;
          extras += `<circle class="${uid}-ring" cx="${o.x}" cy="${o.y}" r="${r}" fill="none" stroke="${A}" stroke-opacity="${(0.16 - i * 0.022).toFixed(3)}" stroke-width="1.2" style="--i:${i}"/>`;
        }
      }

      // ---- ohio river (cartographic) ----
      if (cfg.river) {
        extras += `<path d="M-20 196 C 120 150, 230 188, 320 150 S 540 120, 800 168"
          fill="none" stroke="${COOL}" stroke-opacity=".22" stroke-width="14" stroke-linecap="round"/>
          <path d="M-20 196 C 120 150, 230 188, 320 150 S 540 120, 800 168"
          fill="none" stroke="${COOL}" stroke-opacity=".12" stroke-width="26" stroke-linecap="round"/>`;
      }

      // ---- compass ----
      if (cfg.compass) {
        const cx = W - 78, cy = 86;
        extras += `<g opacity=".7" font-family="'Geist Mono',monospace">
          <circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="${SLATE}" stroke-opacity=".25"/>
          <path d="M${cx} ${cy - 30} L${cx + 5} ${cy} L${cx} ${cy + 30} L${cx - 5} ${cy} Z" fill="${A}" opacity=".9"/>
          <text x="${cx}" y="${cy - 34}" fill="${SLATE}" font-size="11" text-anchor="middle" opacity=".7">N</text>
        </g>`;
      }

      // ---- network lines between neighbors (cartographic) ----
      if (cfg.network) {
        const reg = C.filter(c => c.t !== 'beyond');
        for (let i = 0; i < reg.length; i++) {
          let nearest = null, nd = 1e9;
          for (let j = 0; j < reg.length; j++) {
            if (i === j) continue;
            const dd = dist(reg[i], reg[j]);
            if (dd < nd) { nd = dd; nearest = reg[j]; }
          }
          if (nearest && nd < 120)
            extras += `<line x1="${reg[i].x}" y1="${reg[i].y}" x2="${nearest.x}" y2="${nearest.y}" stroke="${SLATE}" stroke-opacity=".07"/>`;
        }
      }

      // ---- arcs from origin to every campus ----
      const arcW = cfg.arc === 'bold' ? 2.6 : cfg.arc === 'thin' ? 1.2 : 1.8;
      C.forEach((c, i) => {
        if (c.t === 'origin') return;
        const po = cfg.posOverrides && cfg.posOverrides[c.n];
        const cx = c.x + (po && po.dx || 0), cy = c.y + (po && po.dy || 0);
        const d = Math.hypot(o.x - cx, o.y - cy);
        const bend = (c.t === 'beyond' ? 0.20 : 0.16) * d * (cx < o.x ? 1 : -1);
        const p = arcPath(o.x, o.y, cx, cy, bend);
        const w = c.t === 'beyond' ? arcW + 0.9 : arcW;
        // soft underglow + bright stroke
        arcs += `<path class="${clsArc}" d="${p}" fill="none" stroke="${A}" stroke-opacity=".16" stroke-width="${w + 4}" stroke-linecap="round" pathLength="1" style="--i:${i}"/>`;
        arcs += `<path class="${clsArc}" d="${p}" fill="none" stroke="url(#${uid}-arc)" stroke-width="${w}" stroke-linecap="round" pathLength="1" style="--i:${i}"/>`;
      });

      // ---- "and beyond" arrows shooting off-frame ----
      function beyondArrow(angDeg, len, w, opts) {
        opts = opts || {};
        const a = angDeg * Math.PI / 180;
        const x2 = o.x + Math.cos(a) * len, y2 = o.y + Math.sin(a) * len;
        const bend = (opts.bend != null) ? opts.bend : 60 * (Math.cos(a) < 0 ? 1 : -1);
        const p = arcPath(o.x, o.y, x2, y2, bend);
        let head = '';
        if (!opts.noHead) {
          // arrowhead — aim along the curve's true end tangent (endpoint - bézier control point)
          const ah = 11;
          const mx = (o.x + x2) / 2, my = (o.y + y2) / 2;
          const dxb = x2 - o.x, dyb = y2 - o.y;
          const lenb = Math.hypot(dxb, dyb) || 1;
          const ctrlX = mx + (-dyb / lenb) * bend, ctrlY = my + (dxb / lenb) * bend;
          const ang2 = Math.atan2(y2 - ctrlY, x2 - ctrlX);
          const a1 = ang2 + 2.6, a2 = ang2 - 2.6;
          head = `<g class="${clsBeyHead}"><path d="M${x2} ${y2} L${(x2 + Math.cos(a1) * ah).toFixed(1)} ${(y2 + Math.sin(a1) * ah).toFixed(1)} M${x2} ${y2} L${(x2 + Math.cos(a2) * ah).toFixed(1)} ${(y2 + Math.sin(a2) * ah).toFixed(1)}" stroke="${A}" stroke-width="${w}" fill="none" stroke-linecap="round" opacity=".7"/></g>`;
        }
        return `<path class="${clsBey}" d="${p}" fill="none" stroke="url(#${uid}-bey)" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${cfg.beyond === 'strong' ? '1 0' : '2 7'}"/>${head}`;
      }
      // ---- "sending" arrows radiating outward past the campuses ----
      // Balanced burst in all open directions (the upper-left sector is
      // left clear for the headline).
      if (cfg.beyond !== 'none') {
        const strong = cfg.beyond === 'strong';
        const w = strong ? 2.1 : 1.5, wS = strong ? 2.6 : 1.8;
        if (cfg.beyondAngles) {
          cfg.beyondAngles.forEach(function (t) { beyond += beyondArrow(t[0], t[1], t[2] || w, t[3]); });
        } else {
          beyond += beyondArrow(72,  strong ? 500 : 470, wS); // S
          beyond += beyondArrow(96,  strong ? 520 : 490, wS); // S
          beyond += beyondArrow(124, strong ? 440 : 410, w);  // SW
          beyond += beyondArrow(33,  strong ? 390 : 360, w);  // SE
          beyond += beyondArrow(4,   strong ? 390 : 360, w);  // E
          beyond += beyondArrow(156, strong ? 370 : 340, w);  // WSW
          beyond += beyondArrow(182, strong ? 360 : 330, w);  // W
          beyond += beyondArrow(-22, strong ? 350 : 320, w);  // ENE
          beyond += beyondArrow(-48, strong ? 310 : 285, w);  // NE (north)
          if (strong) { beyond += beyondArrow(110, 470, w); beyond += beyondArrow(-34, 330, w); }
        }
      }

      // ---- nodes (every campus identical — same size + ember color) ----
      C.forEach((c, i) => {
        const r = 4.5;
        const po = cfg.posOverrides && cfg.posOverrides[c.n];
        const X = c.x + (po && po.dx || 0), Y = c.y + (po && po.dy || 0);
        if (cfg.pin === 'map') {
          nodes += `<g class="${clsNode}" style="--i:${i}">
            <circle cx="${X}" cy="${Y}" r="11" fill="url(#${uid}-dot)" opacity=".45"/>
            <path d="M${X} ${Y - 13} C ${X - 7} ${Y - 13} ${X - 7} ${Y - 3} ${X} ${Y + 2} C ${X + 7} ${Y - 3} ${X + 7} ${Y - 13} ${X} ${Y - 13} Z" fill="${A}" filter="url(#${uid}-glow)"/>
            <circle cx="${X}" cy="${Y - 8}" r="2.4" fill="#0e1418"/></g>`;
        } else {
          nodes += `<g class="${clsNode}" style="--i:${i}">
            <circle cx="${X}" cy="${Y}" r="${r + 6}" fill="url(#${uid}-dot)" opacity=".55"/>
            <circle cx="${X}" cy="${Y}" r="${r}" fill="${A}" filter="url(#${uid}-glow)"/>
            <circle cx="${X}" cy="${Y}" r="${r * 0.42}" fill="${cfg.centerFill || SLATE}"/></g>`;
        }
      });

      // ---- labels (uniform — every campus the same) ----
      if (cfg.labels !== 'none') {
        const fam = "'Geist Mono', ui-monospace, monospace";
        const ov = cfg.labelOverrides || null;
        C.forEach(c => {
          let L = LBL[c.n]; if (!L) return;
          if (ov && ov[c.n]) L = Object.assign({}, L, ov[c.n]);
          if (L.hide) return;
          const po = cfg.posOverrides && cfg.posOverrides[c.n];
          const ddx = po && po.dx || 0, ddy = po && po.dy || 0;
          const nd = cfg.labelNudge && cfg.labelNudge[c.n];   // label-only micro offset
          const ndx = nd && nd.dx || 0, ndy = nd && nd.dy || 0;
          const lx = L.lx + ddx + ndx, ly = L.ly + ddy + ndy, cx = c.x + ddx, cy = c.y + ddy;
          if (L.lead) {
            const sx = L.a === 'start' ? lx - 6 : lx + 4;
            const ex = cx + (cx > sx ? -5 : 5);
            labels += `<line x1="${sx}" y1="${ly - 3}" x2="${ex}" y2="${cy}" stroke="${SLATE}" stroke-opacity="${cfg.leadOpacity || 0.22}"/>`;
          }
          labels += `<text x="${lx}" y="${ly}" font-family="${fam}" font-size="11" font-weight="500" fill="${cfg.labelFill || '#dfe3e6'}" text-anchor="${L.a}" letter-spacing=".04em">${c.s}</text>`;
        });
      }

      const svg = `<svg viewBox="${cfg.viewBox || ('0 0 ' + W + ' ' + H)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block">
        <defs>${defs}</defs>
        ${bg}<g>${grid}</g>
        <g transform="translate(${cfg.offsetX || 0}, ${cfg.shiftY || 0}) scale(${cfg.scale || 1})">
          <g>${extras}</g>
          <g class="${uid}-arclayer">${arcs}</g>
          <g class="${uid}-beylayer">${beyond}</g>
          <g>${nodes}</g>
          <g>${labels}</g>
        </g>
      </svg>`;

      const style = `<style>
        @keyframes ${uid}-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes ${uid}-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ${uid}-pop  { 0%{ transform: scale(.2); opacity:0 } 60%{ opacity:1 } 100%{ transform: scale(1); opacity:1 } }
        @keyframes ${uid}-pulse{ 0%{ r:9; opacity:.9 } 100%{ r:30; opacity:0 } }
        @keyframes ${uid}-ringpulse{ 0%,100%{ opacity:.14 } 50%{ opacity:.04 } }
        .${uid}-arc { stroke-dasharray: 1; stroke-dashoffset: 1; animation: ${uid}-draw 1.1s cubic-bezier(.5,0,.2,1) forwards; animation-delay: calc(.25s + var(--i,0) * .07s); }
        .${uid}-bey { opacity: 0; animation: ${uid}-fade 1s ease forwards 1s; }
        .${uid}-beyhead { opacity: 0; animation: ${uid}-fade .45s ease forwards 1.9s; }
        .${uid}-node { transform-box: fill-box; transform-origin: center; opacity: 0; animation: ${uid}-pop .5s cubic-bezier(.3,1.4,.4,1) forwards; animation-delay: calc(.5s + var(--i,0) * .07s); }
        .${uid}-pulse { transform-box: fill-box; transform-origin: center; animation: ${uid}-pulse 2.8s ease-out infinite; }
        .${uid}-ring { animation: ${uid}-ringpulse 4s ease-in-out infinite; animation-delay: calc(var(--i,0) * .3s); }
        @media (prefers-reduced-motion: reduce) {
          .${uid}-arc { animation: none; stroke-dashoffset: 0; }
          .${uid}-bey,.${uid}-node,.${uid}-beyhead { animation: none; opacity: 1; }
          .${uid}-pulse { animation: none; opacity: 0; }
        }
      </style>`;

      host.innerHTML = style + svg;
    }
  };
})();
