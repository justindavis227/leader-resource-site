// Rebuilds the downloadable PDFs in pdf/ from the HTML pages.
// The list of PDFs comes from the "↓ PDF" links on the Resource Library page,
// so a new booklet gets a PDF as soon as the Library links to it.
//
//   node tools/build-pdfs.mjs --all                 rebuild every PDF
//   node tools/build-pdfs.mjs --changed changed.txt rebuild only what a push touched
//   node tools/build-pdfs.mjs "2 - Group Leaders.html"   rebuild one page
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(ROOT, 'tools', 'lrs-pdf-render.mjs');
const LIB = path.join(ROOT, '0 - Resource Library.dc.html');

// every pdf/<name>.pdf the Library links to, paired with its <name>.html source
const lib = fs.readFileSync(LIB, 'utf8');
const targets = [...new Set([...lib.matchAll(/href="pdf\/([^"]+)\.pdf"/g)].map((m) => m[1]))]
  .map((n) => ({ pdf: `pdf/${n}.pdf`, html: `${n}.html` }))
  .filter((t) => fs.existsSync(path.join(ROOT, t.html)));

// files every page depends on: if one of these changes, rebuild everything
const SHARED = [/^colors_and_type\.css$/, /^support\.js$/, /^deck-stage\.js$/, /^campus-map\.js$/, /^assets\/(?!craft\/)/, /^tools\//, /^\.github\/workflows\//];

const args = process.argv.slice(2);
let todo;
if (args[0] === '--all') todo = targets;
else if (args[0] === '--changed') {
  const changed = fs.readFileSync(args[1], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  if (changed.some((f) => SHARED.some((re) => re.test(f)))) todo = targets;
  else todo = targets.filter((t) => changed.includes(t.html));
} else todo = targets.filter((t) => args.includes(t.html));

console.log(`Rendering ${todo.length} of ${targets.length} PDFs`);
fs.mkdirSync(path.join(ROOT, 'pdf'), { recursive: true });
let failed = 0;
for (const t of todo) {
  try {
    const out = execFileSync('node', [RENDER, '--site', ROOT, '--page', t.html, '--mode', 'clean', '--out', path.join(ROOT, t.pdf)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 300000 });
    console.log('  ✓', t.pdf, out.trim().split('\n').pop());
  } catch (e) { failed++; console.error('  ✗', t.pdf, e.message.split('\n')[0]); }
}
if (failed) { console.error(failed + ' PDF(s) failed'); process.exit(1); }
