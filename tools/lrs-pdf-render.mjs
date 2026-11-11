#!/usr/bin/env node
/*
 * lrs-pdf-render.mjs — durable PDF renderer for the Leader Resource Site
 * ---------------------------------------------------------------------------
 * Run inside a Cowork cloud container (has node + npm registry + Playwright's
 * Chromium at /opt/pw-browsers). Renders any booklet/resource page to a
 * true-size PDF, in either mode:
 *
 *   clean : chrome-free reader download (booklets 8x8, resources 8.5x11,
 *           R13 17x11). This is what lives in the repo's  pdf/  folder.
 *   crop  : print-shop version — same page centered on a +0.4in sheet with
 *           corner crop marks (booklets 8in trim on 8.4in sheet).
 *
 * Usage:
 *   node lrs-pdf-render.mjs --site <siteDir> --page "5 - Fall 2026 Group Content.dc.html" \
 *        --mode clean --out /tmp/out.pdf
 *   node lrs-pdf-render.mjs --site <siteDir> --page "..." --mode crop --out /tmp/print.pdf
 *
 * Why this file exists (each of these cost a full re-derivation before it was saved):
 *   1. unpkg.com + Google Fonts are BLOCKED in the sandbox, but .dc.html pages
 *      need React/ReactDOM/Babel (from unpkg) to render at all. We vendor the
 *      exact pinned versions from npm and serve them + the fonts by intercepting
 *      every request — fully offline. SRI in support.js still matches (npm==unpkg bytes).
 *   2. The dc runtime lays pages out as 2-up .spread pairs. We flatten to one
 *      .pg per PDF page and DROP the cover-float blank spacer (the aria-hidden
 *      leading cell) so a 60-page booklet is 60 pages, not 61.
 *   3. Two fixed navs (#libnav, .viewbar) paint on every page — hidden.
 *   4. ACCENT BUG (the one that bit us twice): --ember (section accent) is set
 *      inline on each .spread and INHERITED by the .pg. The crop path reparents
 *      the .pg out of its spread, which drops the override and falls back to the
 *      orange default (#eb6424). We snapshot each page's computed --ember (and any
 *      per-spread custom props) onto the .pg BEFORE detaching. Start Up stays blue.
 *   5. Real fonts must actually load before print or Chromium falls back and text
 *      mis-wraps. We force document.fonts.load(...) for every weight, then await ready.
 *   6. Render in SCREEN media (print media strips the accent/hazard art), backgrounds on.
 *   7. Page-count guard: after render, page count MUST equal the .pg count; any
 *      stray blank page is deleted (belt-and-suspenders on top of #2/#3).
 *
 * No Ghostscript anywhere (it flattens the cover gradients + hazard stripes).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ---- resolve Playwright (global in the Cowork container) --------------------
function loadChromium() {
  const cands = [];
  try { cands.push(require.resolve('playwright')); } catch {}
  cands.push('/home/claude/.npm-global/lib/node_modules/playwright');
  cands.push('/opt/node-tools/node_modules/playwright');
  if (process.env.PLAYWRIGHT_PATH) cands.push(process.env.PLAYWRIGHT_PATH);
  for (const c of cands) { try { return require(c).chromium; } catch {} }
  throw new Error('playwright not found; set PLAYWRIGHT_PATH');
}

// ---- args -------------------------------------------------------------------
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const SITE = arg('site');
const PAGE = arg('page');
const MODE = arg('mode', 'clean');
const OUT  = arg('out');
if (!SITE || !PAGE || !OUT) { console.error('need --site --page --out (--mode clean|crop)'); process.exit(1); }

// ---- one-time cache: vendored deps + fonts (fetched from npm if missing) -----
const CACHE = process.env.LRS_PDF_CACHE || path.join(os.tmpdir(), 'lrs-pdf-cache');
const VEND = path.join(CACHE, '_vendor');
const FONTS = path.join(CACHE, '_fonts');

function ensureSetup() {
  fs.mkdirSync(VEND, { recursive: true });
  fs.mkdirSync(FONTS, { recursive: true });
  const need = ['react.production.min.js', 'react-dom.production.min.js', 'babel.min.js']
    .some((f) => !fs.existsSync(path.join(VEND, f)));
  if (need) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrsv-'));
    execSync('npm pack react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0', { cwd: tmp, stdio: 'ignore' });
    for (const t of fs.readdirSync(tmp).filter((f) => f.endsWith('.tgz'))) execSync(`tar xzf "${t}"`, { cwd: tmp });
    // MUST be the UMD builds (window globals) — the cjs builds share the same
    // filename but different bytes and would fail support.js's SRI check, so
    // React never boots and only the 22 raw template pages render.
    const findUmd = (n) => execSync(`find "${tmp}" -path "*umd*" -name "${n}" | head -1`, { encoding: 'utf8' }).trim();
    const findAny = (n) => execSync(`find "${tmp}" -name "${n}" | head -1`, { encoding: 'utf8' }).trim();
    fs.copyFileSync(findUmd('react.production.min.js'), path.join(VEND, 'react.production.min.js'));
    fs.copyFileSync(findUmd('react-dom.production.min.js'), path.join(VEND, 'react-dom.production.min.js'));
    fs.copyFileSync(findAny('babel.min.js'), path.join(VEND, 'babel.min.js'));
    // verify SRI against support.js's pinned hashes (fail loud rather than render 22 pages)
    const sri = { 'react.production.min.js': 'DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z', 'react-dom.production.min.js': 'gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1', 'babel.min.js': 'm08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y' };
    for (const [f, want] of Object.entries(sri)) {
      const got = execSync(`openssl dgst -sha384 -binary "${path.join(VEND, f)}" | openssl base64 -A`, { encoding: 'utf8' }).trim();
      if (got !== want) throw new Error(`vendored ${f} SRI mismatch (got ${got}) — wrong build fetched`);
    }
  }
  if (fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff2')).length < 11) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrsf-'));
    execSync('npm i @fontsource/anton @fontsource/boldonse @fontsource/geist-mono @fontsource/inter @fontsource/montserrat', { cwd: tmp, stdio: 'ignore' });
    const nm = path.join(tmp, 'node_modules', '@fontsource');
    const grab = (pkg, pat, dest) => {
      const dir = path.join(nm, pkg, 'files');
      const hit = fs.readdirSync(dir).find((f) => f.includes(pat));
      if (hit) fs.copyFileSync(path.join(dir, hit), path.join(FONTS, dest));
    };
    grab('anton', 'latin-400-normal.woff2', 'anton-400.woff2');
    grab('boldonse', 'latin-400-normal.woff2', 'boldonse-400.woff2');
    for (const w of [400, 500, 600, 700]) grab('geist-mono', `latin-${w}-normal.woff2`, `geistmono-${w}.woff2`);
    for (const w of [400, 500, 600, 700]) grab('inter', `latin-${w}-normal.woff2`, `inter-${w}.woff2`);
    grab('inter', 'latin-400-italic.woff2', 'inter-400i.woff2');
    grab('montserrat', 'latin-400-normal.woff2', 'montserrat-400.woff2');
    for (const w of [600, 700, 800]) grab('montserrat', `latin-${w}-normal.woff2`, `montserrat-${w}.woff2`);
  }
}

const FONTCSS = `
@font-face{font-family:'Anton';font-weight:400;src:url('http://lrs.local/_fonts/anton-400.woff2') format('woff2');font-display:block}
@font-face{font-family:'Boldonse';font-weight:400;src:url('http://lrs.local/_fonts/boldonse-400.woff2') format('woff2');font-display:block}
@font-face{font-family:'Geist Mono';font-weight:400;src:url('http://lrs.local/_fonts/geistmono-400.woff2') format('woff2');font-display:block}
@font-face{font-family:'Geist Mono';font-weight:500;src:url('http://lrs.local/_fonts/geistmono-500.woff2') format('woff2');font-display:block}
@font-face{font-family:'Geist Mono';font-weight:600;src:url('http://lrs.local/_fonts/geistmono-600.woff2') format('woff2');font-display:block}
@font-face{font-family:'Geist Mono';font-weight:700;src:url('http://lrs.local/_fonts/geistmono-700.woff2') format('woff2');font-display:block}
@font-face{font-family:'Inter';font-weight:400;src:url('http://lrs.local/_fonts/inter-400.woff2') format('woff2');font-display:block}
@font-face{font-family:'Inter';font-weight:500;src:url('http://lrs.local/_fonts/inter-500.woff2') format('woff2');font-display:block}
@font-face{font-family:'Inter';font-weight:600;src:url('http://lrs.local/_fonts/inter-600.woff2') format('woff2');font-display:block}
@font-face{font-family:'Inter';font-weight:700;src:url('http://lrs.local/_fonts/inter-700.woff2') format('woff2');font-display:block}
@font-face{font-family:'Inter';font-style:italic;font-weight:400;src:url('http://lrs.local/_fonts/inter-400i.woff2') format('woff2');font-display:block}
@font-face{font-family:'Montserrat';font-weight:400;src:url('http://lrs.local/_fonts/montserrat-400.woff2') format('woff2');font-display:block}
@font-face{font-family:'Montserrat';font-weight:600;src:url('http://lrs.local/_fonts/montserrat-600.woff2') format('woff2');font-display:block}
@font-face{font-family:'Montserrat';font-weight:700;src:url('http://lrs.local/_fonts/montserrat-700.woff2') format('woff2');font-display:block}
@font-face{font-family:'Montserrat';font-weight:800;src:url('http://lrs.local/_fonts/montserrat-800.woff2') format('woff2');font-display:block}
`;

const MIME = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.gif': 'image/gif', '.webp': 'image/webp' };

async function main() {
  ensureSetup();
  const chromium = loadChromium();
  const b = await chromium.launch({ executablePath: process.env.LRS_CHROME || chromium.executablePath() });
  const pg = await b.newPage({ viewport: { width: 1400, height: 2000 }, deviceScaleFactor: 2 });

  await pg.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    try {
      if (u.hostname === 'unpkg.com') { const fp = path.join(VEND, path.basename(u.pathname)); return fs.existsSync(fp) ? route.fulfill({ body: fs.readFileSync(fp), contentType: 'text/javascript' }) : route.abort(); }
      if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ body: FONTCSS, contentType: 'text/css' });
      if (u.hostname === 'fonts.gstatic.com') return route.abort();
      if (path.basename(u.pathname) === 'print-marks.js') return route.fulfill({ body: '/* excluded for render */', contentType: 'text/javascript' });
      if (u.hostname === 'lrs.local') {
        if (u.pathname.startsWith('/_fonts/')) { const fp = path.join(FONTS, path.basename(u.pathname)); return fs.existsSync(fp) ? route.fulfill({ body: fs.readFileSync(fp), contentType: 'font/woff2' }) : route.abort(); }
        const fp = path.join(SITE, decodeURIComponent(u.pathname));
        if (fp.startsWith(SITE) && fs.existsSync(fp) && !fs.statSync(fp).isDirectory()) return route.fulfill({ body: fs.readFileSync(fp), contentType: MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        return route.abort();
      }
      return route.abort();
    } catch { return route.abort(); }
  });

  await pg.goto('http://lrs.local/' + encodeURIComponent(PAGE), { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
  await pg.emulateMedia({ media: 'screen' });
  // page-unit detection. Three layouts in the wild:
  //   pg    : booklet 5 / dc decks — .pg inside 2-up .spread pairs
  //   rpage : resource sheets (R1-R13)
  //   pair  : booklet 4 (Leader Huddles) — .sc-host > .stage > .stack.spread > .pair > section.page
  //           (added 2026-08-02; the .pg branch never matched this doc and it timed out)
  const kind = await pg.evaluate(() => {
    if (document.querySelector('.pg')) return 'pg';
    if (document.querySelector('.rpage')) return 'rpage';
    if (document.querySelector('.pair > .page')) return 'pair';
    if (document.querySelector('.sheet')) return 'sheet';   // R13 5 Phases (17x11 standalone map)
    return 'pg';
  });
  const sel = kind === 'rpage' ? '.rpage' : kind === 'pair' ? '.pair > .page' : kind === 'sheet' ? '.sheet' : '.pg';
  await pg.waitForSelector(sel, { state: 'attached', timeout: 20000 });
  await pg.evaluate(() => document.fonts.ready);
  // force all weights to load
  await pg.evaluate(async () => {
    const specs = [['Neue Haas Grotesk Display Pro',400],['Neue Haas Grotesk Display Pro',500],['Neue Haas Grotesk Display Pro',700],['Neue Haas Grotesk Display Pro',900],['Anton',400],['Boldonse',400],['Geist Mono',400],['Geist Mono',500],['Geist Mono',600],['Geist Mono',700],['Inter',400],['Inter',500],['Inter',600],['Inter',700],['Montserrat',400],['Montserrat',600],['Montserrat',700],['Montserrat',800]];
    await Promise.all(specs.map(([f, w]) => document.fonts.load(`${w} 16px '${f}'`).catch(() => {})));
    await document.fonts.load("italic 400 16px 'Inter'").catch(() => {});
    await document.fonts.ready;
  });

  // wait until the dc runtime stops cloning lesson pages: page count must be
  // unchanged for 900ms (handles both "already full" and "grows to full")
  await pg.evaluate(async (r) => {
    let prev = -1, stableMs = 0, total = 0;
    while (stableMs < 900 && total < 25000) {
      await new Promise((res) => setTimeout(res, 150)); total += 150;
      const c = document.querySelectorAll(r).length;
      if (c === prev && c > 0) stableMs += 150; else { stableMs = 0; prev = c; }
    }
  }, sel);
  await pg.waitForTimeout(300);

  // page geometry from inline px size (layout-independent), fallbacks after
  const geo = await pg.evaluate(({ r, k }) => {
    const el = document.querySelector(r);
    const px = (v) => { const m = /([\d.]+)px/.exec(v || ''); return m ? parseFloat(m[1]) : 0; };
    // pair books: the .stack.spread carries a fit-to-viewport transform:scale, so
    // getBoundingClientRect() reports the SCALED size (684px, i.e. 7.13in instead of 8in).
    // offsetWidth/Height are transform-independent — measure with those first.
    if (k === 'sheet') return { w: 1632, h: 1056 };   // R13 is a fixed 17x11 board behind a fit-to-viewport scale
    if (k === 'pair') return { w: px(el.style.width) || el.offsetWidth || el.getBoundingClientRect().width, h: px(el.style.height) || el.offsetHeight || el.getBoundingClientRect().height };
    return { w: px(el.style.width) || el.getBoundingClientRect().width || el.offsetWidth, h: px(el.style.height) || el.getBoundingClientRect().height || el.offsetHeight };
  }, { r: sel, k: kind });
  const inW = Math.round(geo.w / 96 * 100) / 100, inH = Math.round(geo.h / 96 * 100) / 100; // px@96 -> in

  const nPg = await pg.evaluate(({ mode, r }) => {
    const pages = [...document.querySelectorAll(r)];
    // (4) snapshot per-spread custom props (accent --ember etc.) onto each page
    pages.forEach((p) => {
      const sp = p.closest('.spread');
      if (sp) for (const prop of sp.style) if (prop.startsWith('--')) p.style.setProperty(prop, sp.style.getPropertyValue(prop));
      const emb = getComputedStyle(p).getPropertyValue('--ember');
      if (emb) p.style.setProperty('--ember', emb.trim());
    });
    // hide fixed navs everywhere
    document.querySelectorAll('#libnav,.viewbar,.toolbar').forEach((e) => e.remove());

    if (mode === 'crop' && r === '.pg') {
      const root = document.createElement('div'); root.id = 'croproot';
      const NEG = '-0.18in', FAR = 'calc(100% + 0.06in)', BR = 'calc(100% - 0.75px)', L = '0.12in', T = '0.75px';
      const specs = [[NEG,'0',L,T],[FAR,'0',L,T],[NEG,BR,L,T],[FAR,BR,L,T],['0',NEG,T,L],[BR,NEG,T,L],['0',FAR,T,L],[BR,FAR,T,L]];
      pages.forEach((p) => {
        const sheet = document.createElement('div'); sheet.className = 'cropsheet';
        const trim = document.createElement('div'); trim.className = 'trimbox';
        trim.appendChild(p);
        specs.forEach((s) => { const m = document.createElement('div'); m.className = 'cropmark'; m.style.cssText = `left:${s[0]};top:${s[1]};width:${s[2]};height:${s[3]};`; trim.appendChild(m); });
        sheet.appendChild(trim); root.appendChild(sheet);
      });
      document.querySelector('.se-stage')?.remove();
      document.body.appendChild(root);
    }
    return pages.length;
  }, { mode: MODE, r: sel });

  // layout CSS
  let pageW, pageH, css;
  if (MODE === 'crop' && sel === '.pg') {
    pageW = (inW + 0.4) + 'in'; pageH = (inH + 0.4) + 'in';
    css = `
      @page { size: ${pageW} ${pageH}; margin: 0; }
      html,body { margin:0!important; padding:0!important; background:#fff!important; }
      #libnav,.viewbar,.toolbar,.se-stage,.sc-host { display:none!important; }
      body > :not(#croproot) { display:none!important; }
      #croproot { display:block!important; background:#fff; }
      .cropsheet { position:relative; width:${pageW}; height:${pageH}; display:flex; align-items:center; justify-content:center; overflow:visible; background:#fff; break-after:page; page-break-after:always; break-inside:avoid; }
      .cropsheet:last-child { break-after:auto; page-break-after:auto; }
      .trimbox { position:relative; width:${inW}in; height:${inH}in; overflow:visible; }
      .cropmark { position:absolute; background:#111; }
      .pg { width:${inW}in!important; height:${inH}in!important; box-shadow:none!important; border-radius:0!important; transform:none!important; overflow:hidden; }`;
  } else {
    pageW = inW + 'in'; pageH = inH + 'in';
    css = `
      @page { size: ${pageW} ${pageH}; margin: 0; }
      html,body { margin:0!important; padding:0!important; background:#fff!important; }
      .se-stage,.sc-host,.book,.spread,.stage,.stack,.pair { display:block!important; transform:none!important; width:auto!important; height:auto!important; min-height:0!important; margin:0!important; padding:0!important; gap:0!important; box-shadow:none!important; background:transparent!important; border:0!important; }
      .book .spread > :not(.pg):not(.rpage) { display:none!important; }
      ${sel} { width:${inW}in!important; height:${inH}in!important; min-height:${inH}in!important; margin:0!important; box-shadow:none!important; border-radius:0!important; break-after:page; page-break-after:always; break-inside:avoid; overflow:hidden; position:relative; }
      ${sel}:last-child { break-after:auto; page-break-after:auto; }
      #libnav,.viewbar,.toolbar { display:none!important; }`;
  }
  // Brand 2026 print rule (Justin): printed material uses the brand face throughout.
  await pg.addStyleTag({ content: ':root{--font-body:var(--font-print)!important;--font-mono:var(--font-print)!important}' + css });
  await pg.waitForTimeout(500);
  await pg.pdf({ path: OUT, width: pageW, height: pageH, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false });
  await b.close();

  console.log(JSON.stringify({ page: PAGE, mode: MODE, domPages: nPg, pageSizeIn: [MODE === 'crop' ? inW + 0.4 : inW, MODE === 'crop' ? inH + 0.4 : inH], out: OUT }));
}
main().catch((e) => { console.error(e); process.exit(1); });
