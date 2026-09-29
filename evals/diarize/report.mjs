// Aggregate .data/diarize-sweep/*.jsonl into markdown tables (stdout).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.data/diarize-sweep');
const rows = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const win = (r) => (r.dur > 600 ? '20 min' : '3 min');
const cfg = (r) => (r.numClusters === -1 ? `thr ${r.threshold}` : `k=${r.numClusters}`);
const pct = (x) => (x * 100).toFixed(0) + '%';
const key = (r) => `${r.shift}|${cfg(r)}`;
const order = ['0.5', '0.25'].flatMap((s) => [...[0.5, 0.6, 0.7, 0.8, 0.9].map((t) => `${s}|thr ${t}`), `${s}|k=N`]);
console.log('| Shift | Clustering | Clusters (3 / 20 min, per fixture) | >=10 s clusters | Coverage, all clusters | Coverage, clusters <10 s dropped | Impure |');
console.log('|---|---|---|---|---|---|---|');
const fixtures = [...new Set(rows.map((r) => r.fixture))];
const by = new Map();
for (const r of rows) { const k = `${r.shift}|${r.numClusters === -1 ? 'thr ' + r.threshold : 'k=N'}`; (by.get(k) ?? by.set(k, []).get(k)).push(r); }
for (const k of order) {
  const rs = by.get(k) ?? [];
  const cell = (w, f) => fixtures.map((fx) => rs.find((r) => r.fixture === fx && win(r) === w) ).map((r) => (r ? f(r) : '-')).join(' / ');
  const [s, c] = k.split('|');
  console.log(`| ${s} | ${c} | 3m: ${cell('3 min', (r) => r.clusters)}; 20m: ${cell('20 min', (r) => r.clusters)} | 3m: ${cell('3 min', (r) => r.ge10s)}; 20m: ${cell('20 min', (r) => r.ge10s)} | 3m: ${cell('3 min', (r) => pct(r.coverage))}; 20m: ${cell('20 min', (r) => pct(r.coverage))} | 3m: ${cell('3 min', (r) => pct(r.coverageDrop['10']))}; 20m: ${cell('20 min', (r) => pct(r.coverageDrop['10']))} | 3m: ${cell('3 min', (r) => pct(r.impure))}; 20m: ${cell('20 min', (r) => pct(r.impure))} |`);
}
console.log('\nFixture order in each cell: ' + fixtures.join(' / '));
console.log('\nMeans over the 3 fixtures (20 min windows):');
console.log('| Shift | Clustering | mean clusters | mean >=10 s | mean coverage | mean coverage (<10 s dropped) | mean impure | mean RTF |');
console.log('|---|---|---|---|---|---|---|---|');
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
for (const w of ['3 min', '20 min']) {
  console.log(`| **${w}** | | | | | | | |`);
  for (const k of order) {
    const rs = (by.get(k) ?? []).filter((r) => win(r) === w);
    if (!rs.length) continue;
    const [s, c] = k.split('|');
    console.log(`| ${s} | ${c} | ${mean(rs.map((r) => r.clusters)).toFixed(1)} | ${mean(rs.map((r) => r.ge10s)).toFixed(1)} | ${pct(mean(rs.map((r) => r.coverage)))} | ${pct(mean(rs.map((r) => r.coverageDrop['10'])))} | ${pct(mean(rs.map((r) => r.impure)))} | ${mean(rs.map((r) => r.rtf)).toFixed(2)} |`);
  }
}
