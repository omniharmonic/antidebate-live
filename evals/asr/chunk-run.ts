// Recording chunk size, 60 s vs 30 s (ruling P3-R12): the lab page runs the production recording
// transcription path (planChunks with a 4 s overlap, the real AsrClient, mergeChunkWords) over each
// scenario cut's mono.wav at both chunk sizes. Words are scored per 60 s window of the cut against the
// FluidAudio/Parakeet words of transcript.utterances.json. Writes the "Recording chunk size" section of
// evals/results.md (replacing the previous one) and .data/asr/chunks.result.json.
//
//   LAB_URL=http://localhost:3100 pnpm tsx evals/asr/chunk-run.ts [--fixture <slug>[,<slug>...]]
//
// Needs the web app in development mode and the scenarios from `adl-scenarios`. The browser profile
// lives in .data/asr-profile (the model is cached there). No model API calls.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_COOKIE, signHostCookie } from '../../apps/web/lib/host-auth';
import { chunkDecision, pooledWer, type ChunkRun, type ChunkWindow } from './chunks';
import { referenceWords } from './reference';
import { werCounts } from './wer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIOS = path.join(ROOT, '.data/scenarios');
const WINDOW_MS = 60_000;
const SIZES = [60_000, 30_000];

type Word = { text: string; startMs: number; endMs: number };
type Chunked = { backend: string; chunkMs: number; chunks: number; words: Word[]; audioSeconds: number; wallSeconds: number; realtimeFactor: number };
type Lab = { __adlLab?: { asrChunked(o: { fixture: string; chunkMs: number }): Promise<Chunked> } };

const { chromium } = createRequire(path.join(ROOT, 'apps/web/package.json'))('@playwright/test') as typeof import('@playwright/test');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function secret(): string {
  if (process.env.HOST_SIGNING_SECRET) return process.env.HOST_SIGNING_SECRET;
  const env = path.join(ROOT, '.env');
  const line = existsSync(env) ? readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('HOST_SIGNING_SECRET=')) : undefined;
  const value = line?.slice('HOST_SIGNING_SECRET='.length).trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error('HOST_SIGNING_SECRET is not set (environment or root .env).');
  return value;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mid = (w: Word) => (w.startMs + w.endMs) / 2;

async function main() {
  const base = process.env.LAB_URL ?? 'http://localhost:3000';
  const all = readdirSync(SCENARIOS).filter((f) => existsSync(path.join(SCENARIOS, f, 'mono.wav'))).sort();
  const fixtures = arg('fixture')?.split(',') ?? all;
  for (const f of fixtures) if (!all.includes(f)) throw new Error(`no scenario ${f} in ${SCENARIOS}`);

  const profile = path.join(ROOT, '.data/asr-profile');
  mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {});
  const out: Record<string, Chunked[]> = {};
  try {
    await context.addCookies([{ name: HOST_COOKIE, value: await signHostCookie(secret(), Date.now()), url: base }]);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.goto(`${base}/host/lab`);
    await page.waitForFunction(() => Boolean((window as unknown as Lab).__adlLab?.asrChunked), undefined, { timeout: 120_000 });
    for (const fixture of fixtures) {
      out[fixture] = [];
      for (const chunkMs of SIZES) {
        const r = (await page.evaluate((o) => (window as unknown as Lab).__adlLab!.asrChunked(o), { fixture, chunkMs })) as Chunked;
        out[fixture].push(r);
        console.log(`${fixture} ${chunkMs / 1000} s: ${r.chunks} chunks, ${r.words.length} words, ${r.realtimeFactor}x in ${r.wallSeconds} s`);
      }
    }
  } finally {
    await context.close();
  }

  const runs: Record<number, ChunkRun> = {};
  for (const chunkMs of SIZES) {
    const windows: ChunkWindow[] = [];
    let audio = 0;
    let wall = 0;
    for (const fixture of fixtures) {
      const fx = path.join(ROOT, 'fixtures/antidebate', fixture);
      const manifest = JSON.parse(readFileSync(path.join(fx, 'manifest.json'), 'utf8')) as { programStartMs?: number };
      const { utterances } = JSON.parse(readFileSync(path.join(fx, 'transcript.utterances.json'), 'utf8')) as { utterances: { words: Word[] }[] };
      const r = out[fixture]!.find((x) => x.chunkMs === chunkMs)!;
      audio += r.audioSeconds;
      wall += r.wallSeconds;
      for (let startMs = 0; startMs + WINDOW_MS <= r.audioSeconds * 1000; startMs += WINDOW_MS) {
        const ref = referenceWords(utterances, manifest.programStartMs ?? 0, startMs, startMs + WINDOW_MS);
        const hyp = r.words.filter((w) => mid(w) >= startMs && mid(w) < startMs + WINDOW_MS).map((w) => w.text);
        const c = werCounts(ref.join(' '), hyp.join(' '));
        windows.push({ fixture, startMs, refWords: c.refWords, errors: c.sub + c.del + c.ins, deletions: c.del });
      }
    }
    runs[chunkMs] = { chunkMs, realtimeFactor: Math.round((audio / Math.max(0.1, wall)) * 10) / 10, windows };
  }
  const d = chunkDecision(runs[60_000]!, runs[30_000]!);
  const winWer = (w: ChunkWindow) => (w.refWords ? w.errors / w.refWords : 0);
  const worst60 = [...runs[60_000]!.windows].sort((a, b) => winWer(b) - winWer(a))[0]!;
  const same30 = runs[30_000]!.windows.find((w) => w.fixture === worst60.fixture && w.startMs === worst60.startMs)!;
  const del = (r: ChunkRun) => r.windows.reduce((n, w) => n + w.deletions, 0);
  const refs = runs[60_000]!.windows.reduce((n, w) => n + w.refWords, 0);
  const worse = runs[60_000]!.windows.flatMap((w) => {
    const o = runs[30_000]!.windows.find((x) => x.fixture === w.fixture && x.startMs === w.startMs)!;
    return winWer(o) - winWer(w) > 0.01 ? [`${w.fixture} ${(w.startMs / 60_000).toFixed(0)}:00, ${pct(winWer(w))} → ${pct(winWer(o))}`] : [];
  });
  mkdirSync(path.join(ROOT, '.data/asr'), { recursive: true });
  writeFileSync(path.join(ROOT, '.data/asr/chunks.result.json'), `${JSON.stringify({ fixtures, decision: d, runs, raw: out }, null, 1)}\n`);

  const date = new Date().toISOString().slice(0, 10);
  const backend = out[fixtures[0]!]![0]!.backend;
  const section = [
    '', `## Recording chunk size, ${date}`, '',
    `The production recording transcription path (planChunks with a 4 s overlap, the shipping \`AsrClient\`, backend ${backend}, headless Chromium, M-series; mergeChunkWords) over ${fixtures.length === 1 ? 'the whole cut' : `${fixtures.length} whole cuts`} (${fixtures.join(', ')}, ${(runs[60_000]!.windows.length)} scored minutes), once with 60 s chunks and once with 30 s chunks. Scored per 60 s window of the cut against the FluidAudio Parakeet TDT v3 words (\`transcript.utterances.json\`, not a human transcript), as in the browser ASR check above. Real-time factor = audio length over the wall time of all chunk calls, after an untimed 5 s warm-up.`, '',
    '| Chunks | Pooled WER | Deletions | Real-time factor |', '|---|---|---|---|',
    ...SIZES.map((s) => `| ${s / 1000} s | ${pct(pooledWer(runs[s]!.windows))} | ${del(runs[s]!)} of ${refs} reference words | ${runs[s]!.realtimeFactor}× |`), '',
    `Worst 60 s window with 60 s chunks: ${worst60.fixture} ${(worst60.startMs / 60_000).toFixed(0)}:00, WER ${pct(winWer(worst60))} (${worst60.deletions} of ${worst60.refWords} reference words deleted); with 30 s chunks ${pct(winWer(same30))} (${same30.deletions} deleted).`, '',
    `Rule (ruling P3-R12): switch to 30 s only if pooled WER improves by at least 2 points, no scored window gets worse by more than 1 point, and the real-time factor stays at least 2×. Here: pooled ${pct(d.pooled60)} → ${pct(d.pooled30)} (${((d.pooled60 - d.pooled30) * 100).toFixed(1)} points), the worst window change is +${(d.worstWorsening * 100).toFixed(1)} points${worse.length ? `; windows worse by more than 1 point: ${worse.join('; ')}` : ''}, 30 s runs at ${runs[30_000]!.realtimeFactor}×.`, '',
    d.switchTo30 ? '**Decision: recordings are transcribed in 30 s chunks from now on.** New sessions only: the chunk size is stored in the recording checkpoint, and a session whose log already has lines keeps its original chunking.' : '**Decision: recordings stay at 60 s chunks.** The rule is not met.', '',
  ].join('\n');
  const resultsPath = path.join(ROOT, 'evals/results.md');
  const results = readFileSync(resultsPath, 'utf8');
  const at = results.search(/\n## Recording chunk size\b/);
  const next = at < 0 ? -1 : results.slice(at + 1).search(/\n## /);
  writeFileSync(resultsPath, at < 0 ? results + section : results.slice(0, at) + section + (next < 0 ? '' : results.slice(at + 1 + next)));
  console.log(JSON.stringify({ decision: d, rtf30: runs[30_000]!.realtimeFactor, rtf60: runs[60_000]!.realtimeFactor, worst60 }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
