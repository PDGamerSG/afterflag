import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const reportPath = resolve(process.env.AFTERFLAG_REPORT ?? 'artifacts/afterflag-report.json');
const outputDir = resolve(process.env.AFTERFLAG_SITE ?? 'site');
mkdirSync(outputDir, { recursive: true });
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const statusClass = (value) => value === 'ready' || value === 'committed' ? 'pass' : value === 'held' || value === 'unsupported-codec' ? 'fail' : '';
const phases = report.phases.map((item) => {
  const status = item.verdict ?? item.ledger?.admission ?? 'observed';
  const chips = [
    '<span class="chip ' + statusClass(status) + '">' + escapeHtml(status) + '</span>',
    item.reason ? '<span class="chip">' + escapeHtml(item.reason) + '</span>' : '',
    item.replacement ? '<span class="chip pass">new job ' + escapeHtml(item.replacement) + '</span>' : '',
    item.redelivery ? '<span class="chip pass">redelivery ' + escapeHtml(item.redelivery) + '</span>' : ''
  ].join('');
  return '<article class="phase">' +
    '<div class="phase-name">' + escapeHtml(item.name.replaceAll('-', ' ')) + '</div>' +
    '<div><h2>' + escapeHtml(item.message ?? 'Recorded evidence') + '</h2>' +
    '<p>Logical time ' + escapeHtml(item.logicalTime ?? '') + '</p>' +
    '<div class="chips">' + chips + '</div></div></article>';
}).join('');

writeFileSync(resolve(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(resolve(outputDir, 'index.html'), [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="description" content="Afterflag evidence from a recorded Flagsmith decoder retirement check.">',
  '<title>Afterflag evidence</title><style>',
  ':root{color-scheme:dark;--ink:#f7f3ec;--muted:#a9a39a;--line:#373631;--panel:#171816;--accent:#b5f36a;--warn:#ffb86b}',
  '*{box-sizing:border-box}body{margin:0;background:#0d0e0c;color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}',
  'main{width:min(1080px,calc(100% - 40px));margin:0 auto;padding:56px 0 80px}',
  'header{display:flex;justify-content:space-between;gap:24px;align-items:start;margin-bottom:48px}',
  'h1{font-size:clamp(40px,8vw,88px);line-height:.92;letter-spacing:-.07em;margin:0;max-width:700px}',
  '.eyebrow{color:var(--accent);font:12px ui-monospace,SFMono-Regular,monospace;letter-spacing:.16em;text-transform:uppercase;margin-bottom:14px}',
  '.lede{color:var(--muted);max-width:570px;font-size:18px}.verdict{border:1px solid var(--accent);color:var(--accent);padding:12px 16px;font:13px ui-monospace,SFMono-Regular,monospace;white-space:nowrap}',
  '.timeline{display:grid;gap:12px}.phase{background:var(--panel);border:1px solid var(--line);padding:24px;display:grid;grid-template-columns:190px 1fr;gap:20px}',
  '.phase-name{color:var(--accent);font:13px ui-monospace,SFMono-Regular,monospace;text-transform:uppercase;letter-spacing:.1em}.phase h2{font-size:25px;letter-spacing:-.03em;margin:0 0 8px}.phase p{color:var(--muted);margin:0 0 14px}',
  '.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{border:1px solid var(--line);padding:6px 9px;color:var(--ink);font:12px ui-monospace,SFMono-Regular,monospace}.chip.pass{border-color:var(--accent);color:var(--accent)}.chip.fail{border-color:var(--warn);color:var(--warn)}',
  'details{margin-top:36px;border-top:1px solid var(--line);padding-top:20px}summary{cursor:pointer;color:var(--muted)}pre{overflow:auto;color:#d8d3ca;font:12px/1.55 ui-monospace,SFMono-Regular,monospace}',
  '@media(max-width:650px){main{width:min(100% - 24px,560px);padding-top:32px}header{display:block}.verdict{display:inline-block;margin-top:24px}.phase{grid-template-columns:1fr;gap:12px;padding:18px}}',
  '</style></head><body><main><header><div>',
  '<div class="eyebrow">Recorded run · local Flagsmith 2.295.2</div><h1>Can this decoder retire?</h1>',
  '<p class="lede">Afterflag follows one queued document across a codec rollout, a live hold, a worker restart, and redelivery. The release verdict is scoped to the declared queue and adapter.</p>',
  '</div><div class="verdict">' + (report.status === 'passed' ? 'RETIREMENT READY' : 'RETIREMENT BLOCKED') + '</div></header>',
  '<section class="timeline" aria-label="Rehearsal timeline">' + phases + '</section>',
  '<details><summary>Open raw evidence</summary><pre>' + escapeHtml(JSON.stringify(report, null, 2)) + '</pre></details>',
  '</main></body></html>'
].join('\n'));
console.log(outputDir);
