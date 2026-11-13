// Mirrors the site's PDFs onto a Craft page (Leader Resource Site — PDF Backup),
// grouped like the Resource Library: Booklets, Resources, Presentations.
// Only PDFs whose bytes changed since the last run are re-uploaded; the old copy is deleted first,
// so the page always holds exactly one current copy of each.
//
//   CRAFT_API_URL=… [CRAFT_API_KEY=…] node tools/craft-backup.mjs
//
// State (which Craft block holds which PDF, and its checksum) lives in pdf/craft-backup.json,
// committed alongside the PDFs. Nothing secret is stored there.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, '0 - Resource Library.dc.html');
const STATE = path.join(ROOT, 'pdf', 'craft-backup.json');
const PAGE = process.env.CRAFT_PAGE_ID || 'BAAF4130-BFCB-4DAD-A7B9-9B073F9C831D';
const BASE = (process.env.CRAFT_API_URL || '').replace(/\/+$/, '');
const KEY = process.env.CRAFT_API_KEY || '';
const DRY = process.argv.includes('--dry-run');
if (!BASE && !DRY) { console.log('CRAFT_API_URL not set; skipping Craft backup.'); process.exit(0); }

// ---- what to back up: every pdf/ link on the Library, in Library order, grouped by section
const lib = fs.readFileSync(LIB, 'utf8');
const SECTIONS = [['booklets', 'Booklets'], ['resources', 'Resources'], ['decks', 'Presentations']];
const starts = SECTIONS.map(([id]) => lib.search(new RegExp(`id="${id}"`))).map((i) => (i < 0 ? Infinity : i));
const sectionAt = (pos) => { let s = 0; starts.forEach((st, i) => { if (pos >= st) s = i; }); return s; };
const seen = new Set();
const items = [];
for (const m of lib.matchAll(/href="pdf\/([^"]+)\.pdf"/g)) {
  const name = m[1];
  if (seen.has(name)) continue; seen.add(name);
  const file = path.join(ROOT, 'pdf', name + '.pdf');
  if (!fs.existsSync(file)) continue;
  const title = name.replace(/\.dc$/, '').replace(/^[A-Z]?\d+[a-z]?\s*-\s*/, '').trim();
  items.push({ key: name, file, fileName: title + '.pdf', section: sectionAt(m.index) });
}
items.sort((a, b) => a.section - b.section);   // stable: keeps Library order inside each section

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { headings: {}, files: {} };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---- Craft API (shared rate limit: 50 req / 10 s per IP), so pace and retry
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, { json, body, headers = {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    await sleep(300);
    const h = { Accept: 'application/json', ...headers };
    if (KEY) h.Authorization = `Bearer ${KEY}`;
    if (json) h['Content-Type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: json ? JSON.stringify(json) : body });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(3000 * attempt); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p.split('?')[0]} → ${res.status} ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return text; }
  }
}
const q = (o) => '?' + new URLSearchParams(o).toString();

async function main() {
  const todo = items.filter((it) => { const s = state.files[it.key]; return !s || s.sha !== sha(it.file); });
  console.log(`${items.length} PDFs on the Library; ${todo.length} new or changed`);
  if (DRY) { todo.forEach((t) => console.log('  would upload', SECTIONS[t.section][1], '›', t.fileName)); return; }

  // what is on the page right now
  const page = await api('GET', '/blocks' + q({ id: PAGE, maxDepth: 1 }));
  const blocks = page.content || [];
  const onPage = new Set(blocks.map((b) => b.id));

  // page skeleton: a "last updated" line and one heading per section
  if (!state.stamp || !onPage.has(state.stamp)) {
    const r = await api('POST', '/blocks', { json: { markdown: 'Last updated: (pending)', position: { pageId: PAGE, position: 'start' } } });
    state.stamp = r.items[0].id;
  }
  let anchor = state.stamp;
  for (const [, label] of SECTIONS) {
    if (!items.some((it) => SECTIONS[it.section][1] === label)) continue;
    if (!state.headings[label] || !onPage.has(state.headings[label])) {
      const r = await api('POST', '/blocks', { json: { markdown: `## ${label}`, position: { siblingId: anchor, position: 'after' } } });
      state.headings[label] = r.items[0].id;
    }
    anchor = state.headings[label];
  }

  // stray copies (same file name, not the block we track) get removed so nothing piles up
  const ours = new Set(items.map((it) => it.fileName));
  const tracked = new Set(Object.values(state.files).map((f) => f.blockId));
  const strays = blocks.filter((b) => b.type === 'file' && ours.has(b.fileName) && !tracked.has(b.id)).map((b) => b.id);
  if (strays.length) { await api('DELETE', '/blocks', { json: { blockIds: strays } }); console.log(`  removed ${strays.length} stray copies`); }

  // walk each section in order; unchanged files stay put and act as the anchor for the next upload
  const changed = new Set(todo.map((t) => t.key));
  let current = -1;
  for (const it of items) {
    if (it.section !== current) { current = it.section; anchor = state.headings[SECTIONS[it.section][1]]; }
    const prev = state.files[it.key];
    const present = prev && onPage.has(prev.blockId);
    if (present && !changed.has(it.key)) { anchor = prev.blockId; continue; }
    if (present) await api('DELETE', '/blocks', { json: { blockIds: [prev.blockId] } });
    const r = await api('POST', '/upload' + q({ position: 'after', siblingId: anchor, fileName: it.fileName }),
      { body: fs.readFileSync(it.file), headers: { 'Content-Type': 'application/pdf' } });
    state.files[it.key] = { blockId: r.blockId, sha: sha(it.file), fileName: it.fileName };
    anchor = r.blockId;
    console.log('  ✓', SECTIONS[it.section][1], '›', it.fileName);
  }

  // forget PDFs the Library no longer links (their Craft copies are left for a human to tidy)
  for (const k of Object.keys(state.files)) if (!items.some((it) => it.key === k)) delete state.files[k];

  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Kentucky/Louisville', dateStyle: 'medium', timeStyle: 'short' });
  const commit = (process.env.GITHUB_SHA || '').slice(0, 7);
  await api('PUT', '/blocks', { json: { blocks: [{ id: state.stamp, markdown:
    `Last updated: **${when}**${commit ? ` · commit ${commit}` : ''} · ${items.length} PDFs. Emergency copy of leader-resources.vercel.app; updates itself on every push.` }] } });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log('Craft backup up to date');
}
main().catch((e) => { console.error('Craft backup failed:', e.message); fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n'); process.exit(1); });
