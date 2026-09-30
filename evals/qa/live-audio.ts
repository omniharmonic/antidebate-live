/** Browser VAD → actual ASR → actual diarization → held transcript; no simulated approvals or LLM.
 * LAB_URL=http://localhost:3000 HOST_SIGNING_SECRET=... pnpm exec tsx evals/qa/live-audio.ts [fixture] [startMs] [endMs]
 * Reuses .data/asr-profile. Requires generated .data/scenarios and the dev-only host lab.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { signHostCookie } from '../../apps/web/lib/host-auth';
import type { DomainEvent } from '../../packages/core/src/index';
import { referenceWords } from '../asr/reference';
import { werCounts } from '../asr/wer';

const [fixture = 'ball-kokotajlo-ai-governance', from = '120000', to = '180000'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(fixture)) throw new Error('Invalid fixture slug');
const startMs = Number(from), endMs = Number(to);
const base = process.env.LAB_URL ?? 'http://localhost:3000';
const secret = process.env.HOST_SIGNING_SECRET;
if (!secret) throw new Error('HOST_SIGNING_SECRET is required');
const context = await chromium.launchPersistentContext(path.resolve('.data/asr-profile'), { headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
type LabWindow = Window & { __adlLab: { auditLive(o: { fixture: string; startMs: number; endMs: number }): Promise<{ events: DomainEvent[]; seconds: number; failed: number; cuts: number }>; captureProbe(): Promise<{ mono: Record<string, number>; tracks: Record<string, number> }> } };
try {
  await context.addCookies([{ name: 'adl_host', value: await signHostCookie(secret, Date.now()), url: base }]);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${base}/host/lab`);
  await page.waitForFunction(() => !!(window as unknown as LabWindow).__adlLab?.auditLive);
  const capture = await page.evaluate(() => (window as unknown as LabWindow).__adlLab.captureProbe());
  if (!(capture.mono['0']! > -20 && capture.tracks['0']! < -80 && capture.tracks['1']! > -10)) throw new Error('Stereo capture regression');
  const result = await page.evaluate((o) => (window as unknown as LabWindow).__adlLab.auditLive(o), { fixture, startMs, endMs });
  const dir = `fixtures/antidebate/${fixture}`;
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as { programStartMs?: number };
  const transcript = JSON.parse(readFileSync(`${dir}/transcript.utterances.json`, 'utf8'));
  const ref = referenceWords(transcript.utterances, manifest.programStartMs ?? 0, startMs, endMs);
  const lines = result.events.flatMap((e) => e.type === 'utterance.final' ? [e.payload.utterance] : []);
  const counts = werCounts(ref.join(' '), lines.map((u) => u.text).join(' '));
  const metrics = { fixture, startMs, endMs, seconds: result.seconds, realtimeFactor: (endMs - startMs) / 1000 / result.seconds, cuts: result.cuts, lines: lines.length, failed: result.failed, counts, wer: (counts.sub + counts.del + counts.ins) / Math.max(1, counts.refWords) };
  mkdirSync('.data/qa', { recursive: true });
  writeFileSync(`.data/qa/live-${fixture}-${startMs}.json`, JSON.stringify({ metrics, capture, events: result.events }, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} finally { await context.close(); }
