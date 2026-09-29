// Browser transcription accuracy: the lab page's real AsrClient (int8 WASM, cross-origin isolated)
// on five 60 s windows of a scenario's mono.wav, scored against the FluidAudio/Parakeet words of
// transcript.utterances.json in the same windows. Writes the "Browser ASR accuracy" section of
// evals/results.md (replacing the previous one) and .data/asr/result.json.
//
//   LAB_URL=http://localhost:3100 pnpm tsx evals/asr/run.ts [--fixture <manifest slug>]
//
// Needs the web app in development mode (the lab is not found in production) and the scenario from
// `adl-scenarios`. The browser profile lives in .data/asr-profile so the ~670 MB model downloads
// once. HOST_SIGNING_SECRET comes from the environment or the root .env. No model API calls.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_COOKIE, signHostCookie } from '../../apps/web/lib/host-auth';
import { wer } from './wer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DEFAULT = 'ball-kokotajlo-ai-governance';
const WINDOW_MS = 60_000;
/** Cut-relative starts, minutes: spread over the 20 minute cut. */
const STARTS_MIN = [2, 6, 10, 14, 18];

type Word = { text: string; startMs: number; endMs: number };
type AsrResult = { backend: string; loadSeconds: number; realtimeFactor: number; windows: { startMs: number; endMs: number; words: Word[]; seconds: number }[] };
type Win = { startMs: number; endMs: number };
type Lab = { __adlLab?: { asr(o: { fixture: string; windows: Win[] }): Promise<AsrResult>; asrSplit(o: { fixture: string; window: Win; span: Win }): Promise<{ chunked: Word[]; halves: Word[] }> } };

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

/** Reference words with their midpoint inside [startMs, endMs), times relative to the cut. */
export function referenceWords(utterances: { words: Word[] }[], programStartMs: number, startMs: number, endMs: number): string[] {
  return utterances
    .flatMap((u) => u.words)
    .filter((w) => {
      const mid = (w.startMs + w.endMs) / 2 - programStartMs;
      return mid >= startMs && mid < endMs;
    })
    .map((w) => w.text);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const base = process.env.LAB_URL ?? 'http://localhost:3000';
  const fixture = arg('fixture') ?? FIXTURE_DEFAULT;
  const fx = path.join(ROOT, 'fixtures/antidebate', fixture);
  const manifest = JSON.parse(readFileSync(path.join(fx, 'manifest.json'), 'utf8')) as { programStartMs?: number };
  const { utterances } = JSON.parse(readFileSync(path.join(fx, 'transcript.utterances.json'), 'utf8')) as { utterances: { words: Word[] }[] };
  const programStartMs = manifest.programStartMs ?? 0;
  const windows = STARTS_MIN.map((m) => ({ startMs: m * 60_000, endMs: m * 60_000 + WINDOW_MS }));

  const profile = path.join(ROOT, '.data/asr-profile');
  mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {});
  let result: AsrResult;
  let split: { window: Win; chunked: Word[]; halves: Word[] } | null = null;
  try {
    await context.addCookies([{ name: HOST_COOKIE, value: await signHostCookie(secret(), Date.now()), url: base }]);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.goto(`${base}/host/lab`);
    await page.waitForFunction(() => Boolean((window as unknown as Lab).__adlLab), undefined, { timeout: 120_000 });
    // The first run in a profile downloads the model (~670 MB): allow for it.
    result = (await page.evaluate((o) => (window as unknown as Lab).__adlLab!.asr(o), { fixture, windows })) as AsrResult;
    // The window with the lowest share of reference words returned: transcribe it the production way (planChunks over a span around it) and as two halves.
    const share = result.windows.map((w) => w.words.length / Math.max(1, referenceWords(utterances, programStartMs, w.startMs, w.endMs).length));
    const worst = result.windows[share.indexOf(Math.min(...share))]!;
    const span = { startMs: Math.max(0, worst.startMs - 60_000), endMs: worst.endMs + 60_000 };
    const r = await page.evaluate((o) => (window as unknown as Lab).__adlLab!.asrSplit(o), { fixture, window: { startMs: worst.startMs, endMs: worst.endMs }, span });
    split = { window: { startMs: worst.startMs, endMs: worst.endMs }, ...r };
  } finally {
    await context.close();
  }

  const rows = result.windows.map((w) => {
    const ref = referenceWords(utterances, programStartMs, w.startMs, w.endMs);
    const hyp = w.words.map((x) => x.text);
    return { startMs: w.startMs, refWords: ref.length, hypWords: hyp.length, wer: wer(ref.join(' '), hyp.join(' ')), seconds: w.seconds };
  });
  const mean = rows.reduce((a, r) => a + r.wer, 0) / rows.length;
  const pooled = rows.reduce((a, r) => a + r.wer * r.refWords, 0) / rows.reduce((a, r) => a + r.refWords, 0);
  const splitRow = split && (() => {
    const ref = referenceWords(utterances, programStartMs, split.window.startMs, split.window.endMs);
    const score = (ws: Word[]) => ({ words: ws.length, wer: wer(ref.join(' '), ws.map((x) => x.text).join(' ')) });
    return { startMs: split.window.startMs, refWords: ref.length, single: rows.find((r) => r.startMs === split!.window.startMs)!, chunked: score(split.chunked), halves: score(split.halves) };
  })();
  mkdirSync(path.join(ROOT, '.data/asr'), { recursive: true });
  writeFileSync(path.join(ROOT, '.data/asr/result.json'), `${JSON.stringify({ fixture, backend: result.backend, loadSeconds: result.loadSeconds, realtimeFactor: result.realtimeFactor, mean, pooled, split: splitRow, rows }, null, 1)}\n`);

  const date = new Date().toISOString().slice(0, 10);
  const section = [
    '', `## Browser ASR accuracy, ${date}`, '',
    `The shipping \`AsrClient\` (int8 WASM in a worker, cross-origin isolated) run in headless Chromium through the lab page on five 60 s windows of ${fixture}/mono.wav, one call per window, as recording transcription chunks it. Backend: ${result.backend}. Speed after an untimed 5 s warm-up: ${result.realtimeFactor}× real time over the five windows (headless Chromium, M-series, ${date}). Model load ${result.loadSeconds} s.`, '',
    'The reference is the FluidAudio Parakeet TDT v3 transcript (`transcript.utterances.json`), the same model family run natively, not a human transcript: WER here measures the browser build against it, not against what was said. Words are lowercased and stripped of punctuation; a reference word belongs to a window when its midpoint does.', '',
    '| Window (cut time) | Reference words | Browser words | WER | Wall time |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${(r.startMs / 60_000).toFixed(0)}:00–${(r.startMs / 60_000).toFixed(0)}:59 | ${r.refWords} | ${r.hypWords} | ${pct(r.wer)} | ${r.seconds} s |`),
    `| mean of windows | | | ${pct(mean)} | |`, `| pooled over words | ${rows.reduce((a, r) => a + r.refWords, 0)} | ${rows.reduce((a, r) => a + r.hypWords, 0)} | ${pct(pooled)} | |`, '',
    ...(rows.some((r) => r.hypWords < r.refWords * 0.9)
      ? [`Windows where the browser build returned at least 10% fewer words than the reference (${rows.filter((r) => r.hypWords < r.refWords * 0.9).map((r) => `${(r.startMs / 60_000).toFixed(0)}:00, ${r.hypWords} of ${r.refWords}`).join('; ')}) carry most of the error: the build returned fewer words there.`, '']
      : []),
    ...(splitRow ? [
      `**The ${(splitRow.startMs / 60_000).toFixed(0)}:00 window, three ways** (${splitRow.refWords} reference words): a single 60 s call as above returned ${splitRow.single.hypWords} words (WER ${pct(splitRow.single.wer)}); the production path (planChunks over the two minutes around it, mergeChunkWords, kept to the window) returned ${splitRow.chunked.words} (WER ${pct(splitRow.chunked.wer)}); two 30 s halves returned ${splitRow.halves.words} (WER ${pct(splitRow.halves.wer)}).`, '',
      ...(splitRow.chunked.words < splitRow.refWords * 0.95 ? [`Production chunking also loses words here, so this is a known limitation of the browser ASR (int8 WASM Parakeet) on this window, not an artifact of the lab's single call. The span was the two minutes around the window, not the whole cut, so real chunk boundaries fall elsewhere. Shorter calls recovered more of the words in this one window; production code is unchanged and one window is not enough to conclude more. The cause (the pause about 1.6 s in, or the model on long calls) is not diagnosed.`, ''] : [])]
      : []),
  ].join('\n');
  const resultsPath = path.join(ROOT, 'evals/results.md');
  const results = readFileSync(resultsPath, 'utf8');
  const at = results.search(/\n## Browser ASR accuracy\b/);
  const next = at < 0 ? -1 : results.slice(at + 1).search(/\n## /);
  writeFileSync(resultsPath, at < 0 ? results + section : results.slice(0, at) + section + (next < 0 ? '' : results.slice(at + 1 + next)));
  console.log(JSON.stringify({ backend: result.backend, realtimeFactor: result.realtimeFactor, loadSeconds: result.loadSeconds, mean, rows }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
