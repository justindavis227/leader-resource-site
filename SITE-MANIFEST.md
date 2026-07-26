# SITE-MANIFEST — Leader Resource Site

_The canonical inventory of what IS the live site. Created 2026-07-19._
_Read this first every sync. It replaces CD's hard-coded "canonical set" list, which drifted (it froze at 0–7 + R1–R8 before R9–R12 and the decks existed)._

---

## Source of truth

| Copy | Location | Role |
|---|---|---|
| **GitHub repo** | `justindavis227/leader-resource-site` (`main`) | **THE LIVE SITE.** Vercel auto-deploys every push. |
| Live URL | https://leader-resources.vercel.app | **Canonical** (as of 2026-07-20). Served from the repo. |
| Old URL | https://leader-resource-site.vercel.app | **307 redirect → canonical**, path-preserving. Keep it: the printed Team Leaders QR codes + the six hardcoded R-links in `3 - Team Leaders.html` still point here. See SESSION-2026-07-20-leader-resource-domain.md. |
| Local root | `~/CoWork/Leader Resource Site/` | Matches live. Hand to CD as the starting point. |

**Scope authority = the hub's link graph.** `0 - Resource Library.dc.html` links every page that belongs on the site. A file that is not linked from the hub is **not** part of the site (it's scratch), no matter what's sitting in a CD export.

---

## Live pages (24)

| File | Type | Section | Notes |
|---|---|---|---|
| `index.html` | html | — | Redirect entry point → resource library |
| `0 - Resource Library.dc.html` | dc | Hub | The library index; links everything below. Booklet display order + 4 "In Progress" badges live here. |
| `1 - Unleashed Leaders Booklet.html` | html | Booklets | Display #1 |
| `5 - Fall 2026 Group Content.dc.html` | dc | Booklets | Display #2 · cover float-right on spread |
| `3 - Team Leaders.html` | html | Booklets | Display #3 · 8 scannable QR codes |
| `4 - Leader Huddles.dc.html` | dc | Booklets | Display #4 · "In Progress" badge |
| `2 - Group Leaders.html` | html | Booklets | Display #5 |
| `6 - Support Leaders.html` | html | Booklets | Display #6 |
| `7 - Student Leadership.html` | html | Booklets | Display #7 |
| `R1 - Spiritual Disciplines Evaluation.html` | html | Resources | ⚠ embed-guard: see note |
| `R2 - Fruit of the Spirit Assessment.html` | html | Resources | ⚠ embed-guard: see note |
| `R3 - Ministry Team Evaluation (Fall).html` | html | Resources | |
| `R4 - Ministry Team Evaluation (Spring).html` | html | Resources | |
| `R5 - Solitary Retreat (Eremos Place).html` | html | Resources | |
| `R6 - Discipleship Map.html` | html | Resources | |
| `R7 - Semester Planning (Fall).html` | html | Resources | |
| `R8 - Semester Planning (Spring).html` | html | Resources | |
| `R9 - Unleashed Leaders One Pager.html` | html | Resources | added 2026-07-18 |
| `R10 - Leader Commitment.html` | html | Resources | added 2026-07-18 |
| `R11 - Baptism Guide.html` | html | Resources | added 2026-07-18 |
| `R12 - 4 Chair Inventory.html` | html | Resources | added 2026-07-18 |
| `R13 - 5 Phases.html` | html | Resources | NEW 2026-07-19 · **17×11 landscape** map (not 8.5×11). Uses **Montserrat**. Self-contained inline script (not print-marks.js); #print redirects to the PDF. |
| `P1 - Unleashed Leaders Deck.dc.html` | dc | **Presentations** | NEW 2026-07-19 · 43 slides |
| `P2 - Team Leaders Deck.dc.html` | dc | **Presentations** | NEW 2026-07-19 · 129 slides |

_(Booklet file numbers 1–7 are the original filenames; the hub renders them in the display order shown above — 1, 5, 3, 4, 2, 6, 7 — per Justin's 2026-07-19 reorder. Do not rename the files.)_

---

## Runtime + shared files (must also be in the repo)

| File | Role |
|---|---|
| `support.js` | The `.dc.html` runtime. Defines `<x-dc>` / `<x-import>` custom elements. **Boots React 18.3.1, ReactDOM, and @babel/standalone 7.29.0 from `unpkg.com` at page load** — if unpkg is unreachable, every `.dc.html` page renders blank. |
| `deck-stage.js` | NEW 2026-07-19. The slide-stage component the decks load via `<x-import from="./deck-stage.js">`. **Required by P1/P2** — without it the decks render blank. Self-contained (no external deps). |
| `colors_and_type.css` | Brand design tokens. Loads **Boldonse** (`--font-display`), **Geist Mono** (`--font-mono`), **Inter** (`--font-body`) from Google Fonts; **Anton** is loaded per-page for the big condensed titles. |
| `print-marks.js` | Two roles now: (1) **always-on** for resource sheets — a correct US-Letter print box + mobile scale-to-fit (transform:scale in a `.rpage-fit` wrapper; NOT CSS `zoom`, which iOS Safari ignores). (2) a `#print`/`?print` hit **redirects to the pre-rendered `/pdf/<doc>.pdf`** instead of `window.print()`. The legacy crop-mark machinery is retained in the file but is dead code behind the redirect. |
| `campus-map.js` | Campus map component. |
| `tweaks-panel.jsx` | Editor tweak panel. |
| `assets/` | `chairs/`, `icons/`, `illos/`, `logos/`, `photos/`, plus `qr-*.svg`. Repo images are web-optimized derivatives. |
| `pdf/` | **Cowork-generated, NOT a CD design surface.** 20 downloadable PDFs (one per doc). See PDF Downloads below. CD never edits these; Cowork regenerates them whenever a doc's HTML changes. |

---

## Standing gotchas (do not relitigate)

- **R1 / R2 embed guard is repo-authoritative.** Live R1/R2 use the scoped `frameElement` guard (fixed repo-side 2026-07-16). CD's sandbox has repeatedly carried the OLD `window.self!==window.top` guard. **Never let a CD export overwrite live R1/R2 without diffing** — a blind push silently reverts the fix.
- **`.dc.html` pages need unpkg.com.** React/ReactDOM/Babel load from the CDN at runtime. Real browsers are fine; sandboxes that block unpkg will show blank pages (not a site bug).
- **A CD "full export" is the whole sandbox, not a clean set.** The real flat export is the nested `_cd-update/` folder; the rest is scratch + source originals. Reconcile against THIS manifest + the live repo, not against CD's self-report.
- **Cowork-applied changes CD's sandbox lacks** (will diff as regressions on a blind full export — re-apply in CD or diff carefully): the booklet reorder + 4 In-Progress badges + Download-pill wiring in the hub; `print-marks.js` PDF-redirect + mobile fix; the booklet-5 `mailto:` fix; the page-0 arrange-mode gate. See HANDOFF-TO-CD.md.
- **Hub intro copy is slightly stale:** `0 - Resource Library` still says "Booklets export with crop marks." The PDFs are now **clean, no crop marks** — CD should update that sentence.
- **EDIT-LOG.md is now current** (backfilled through 2026-07-19). It had been silent for the deck work; it is caught up as of sync `e33999e`.

---

## PDF Downloads (added 2026-07-19)

Every doc has a real, downloadable PDF at `pdf/<same-name>.pdf` — true-size (R1–R12 = 8.5×11, R13 = 17×11, booklets = 8×8), full-bleed, **no browser chrome, no crop marks**. This replaced the old browser-print flow (which on iOS Safari injected a URL/date header and split sheets across 2 pages).

Wiring:
- **Hub Download pills** → `pdf/<name>.pdf` (relative href, with `download`).
- **`print-marks.js`**: a `#print` / `?print` hit **redirects to `pdf/<doc>.pdf`** instead of `window.print()`.

Regeneration (IMPORTANT — PDFs are snapshots): a PDF is generated from the doc's HTML at a point in time. **When a doc's HTML changes, its PDF must be regenerated** or the download goes stale.

Pipeline (as-built, after several corrections — follow this exactly):
- Headless Chromium (Playwright) → `page.pdf()` at the doc's true page size, `margin:0`, `printBackground:true`. `print-marks.js` is excluded from the render so there are no crop marks.
- **Resources render in SCREEN media** (print media stripped the accent/hazard art). Booklets also render with backgrounds on.
- **Real fonts must be installed as system TTFs** — Anton, Inter, Geist Mono, Boldonse, **and Montserrat (for R13)**. Headless Chromium can't fetch Google Fonts / @font-face woff2 offline, so without the system TTFs it silently falls back to DejaVu/Liberation and the text mis-wraps and looks wrong. (This was the root cause of the "download doesn't match the screen" bug.) NOTE: the @fontsource Montserrat woff2 name-tables are polluted ("Montserrat Thin ExtraBold" etc.) — rewrite nameID 1 to "Montserrat" with correct usWeightClass before installing, or CSS `font-family:'Montserrat'` won't match.
- **R13 is 17×11 landscape** (1632×1056), rendered with `page.pdf({width:'17in',height:'11in'})`. Its thumbnail in the hub is a scaled iframe (`data-fit="1632"`, `transform:scale(.1838)`).
- **Do NOT use Ghostscript.** It flattens semi-transparent overlays and killed the cover gradients + hazard stripes. Instead downsample source photos (~1800px) before render and process with Fitz/PyMuPDF only.
- Booklet 5 needs spread-collapse CSS (its pages are `.pg` inside 2-up `.spread` pairs); drop its cover-float blank spacer page.

Last sync: 2026-07-19 — booklet **1 → 40 pages** (2 Notes pages added; imposition now divisible by 4) + booklet **5** Beyond Boring / Those People series overviews; both PDFs regenerated (8×8). Prior same-day: added **R13 "5 Phases"** (17×11 map): new page, hub card merged onto live (preserving all pdf pills), 7 phase images, 17×11 PDF. Native-print hardening also live (`break-inside:avoid` on resource sheets). Prior: `e33999e` EDIT-LOG backfill; PDFs `185de6f`/`bc95ce1`.

**⚠ CD hub reverts the PDF pills.** CD's sandbox has no knowledge of the `pdf/` Download wiring, so a CD export of `0 - Resource Library.dc.html` points every Download pill at `<name>.html#print` instead of `pdf/<name>.pdf`. **Never push a CD hub wholesale** — merge CD's additions (new cards, ordering tweaks) onto the LIVE hub, or re-apply the 20 pdf pills. (Same class of gotcha as R1/R2.)

---

## Unlinked paths (live but outside the hub link graph)

_Exception to "scope authority = the hub's link graph": these paths are deliberately live WITHOUT a hub link. They are part of the repo — do NOT delete them as scratch during a sync reconcile._

| Path | What | Source |
|---|---|---|
| `group-cards/index.html` | Group Cards Fall 2026 viewer app (per-week deep links `#s1w3` etc., copy-link + PDF pills). Shared with leaders by direct link only. | **Cowork-generated** from `~/CoWork/Leader Resource Site/Group Cards/` (`make_app.py`). CD never edits. |
| `group-cards/pdf/S#-W#-<series>.pdf` | 17 per-week card PDFs (clean trim size) the app's Download pills point at. | Cowork-generated (`build_cards.py --mode screen`). Regenerate + re-upload whenever card content changes. |

Print-shop files for the cards (5×7 sheet + crop marks) are NOT in the repo — they live at `Group Cards/output/shop/` locally; profile `group_card_3p5x6p22_set` in `tools/printshop-config.json`.
