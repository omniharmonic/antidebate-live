// The whole live path in Node: segmenter frames → LiveRunner (stub ASR and voice match) → memory
// log → SessionEngine with a fake model caller that records what L1 is asked to read.
import { afterEach, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { SessionEngine } from '@adl/engine';
import { setCaller } from '@adl/llm';
import { MemoryEventLog } from './memory-log';
import { LiveRunner } from './runner';
import { Segmenter } from './segmenter';

const FRAME = 320;
const tone = (amp: number) => Float32Array.from({ length: FRAME }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 16_000));
const quiet = () => Float32Array.from({ length: FRAME }, (_, i) => 0.0005 * Math.sin(i));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sid = 'live-path';
const channels = { d0c0: 'A', d0c1: 'B' };

type Speech = { from: number; to: number; d0c0: number; d0c1: number };

/** Feeds 20 ms frames on both channels; returns when the runner has handled every cut. */
async function speak(runner: LiveRunner, offsetMs: number, frames: number, plan: Speech[]) {
  const done: Promise<void>[] = [];
  const seg = new Segmenter({ channels: Object.keys(channels), offsetMs, wallStartMs: 0, onUtterance: (x) => done.push(runner.onUtterance(x.channel, x.u, x.rms, x.overlap)) });
  for (let i = 0; i < frames; i++) {
    const s = plan.find((p) => i >= p.from && i < p.to);
    for (const c of ['d0c0', 'd0c1'] as const) seg.push(c, s ? tone(s[c]) : quiet(), i * 20);
  }
  runner.tick(offsetMs + frames * 20 + 10_000, {});
  await Promise.all(done);
}

const finals = (log: MemoryEventLog) => log.events.flatMap((e) => (e.type === 'utterance.final' ? [e.payload.utterance] : []));
const turns = (log: MemoryEventLog) => log.events.flatMap((e) => (e.type === 'turn.closed' ? [e.payload] : []));

afterEach(() => setCaller(async (c) => ({ ok: false, reason: 'provider_error', detail: 'reset', log: { pass: c.pass } as never })));

it('miked lines reach L1 under the right speaker, held lines only once confirmed, and a reload keeps going', async () => {
  const l1: string[] = [];
  setCaller(async (c) => { if (c.pass === 'L1_extract') l1.push(c.input); return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }; });
  const log = new MemoryEventLog();
  await log.append([{ eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: new Date(0).toISOString(), payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } } as DomainEvent]);
  const make = () => new LiveRunner({
    sessionId: sid,
    setup: { kind: 'tracks', channels, participants: [{ key: 'A', displayName: 'Ann' }, { key: 'B', displayName: 'Bo' }] },
    anchors: [{ key: 'A', pcm: tone(0.3) }, { key: 'B', pcm: tone(0.3) }],
    asr: { transcribe: async (_p, off) => [{ text: `said at ${off}`, startMs: off, endMs: off + 500 }] },
    // Only unclear margins are matched; this voice is too unsure to accept.
    voices: { matchVoices: async () => ({ A: 0.1, B: 0.3 }) },
    log,
    onStatus: () => {},
  });
  const engine = () => new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 20 });

  const runner = make();
  const e1 = engine();
  const r1 = e1.run();
  // Lines a few seconds apart, each closed into its own turn by the engine's silence timer.
  await speak(runner, 0, 250, [{ from: 50, to: 150, d0c0: 0.3, d0c1: 0.03 }]); // Ann on her mic, 20 dB clear
  await sleep(100);
  await speak(runner, 5_000, 250, [{ from: 50, to: 150, d0c0: 0.12, d0c1: 0.3 }]); // Bo, only 8 dB clear: matched, and held
  await sleep(100);
  await speak(runner, 10_000, 250, [{ from: 50, to: 150, d0c0: 0.3, d0c1: 0.03 }]); // Ann again
  await sleep(150);
  const lines = finals(log);
  expect(lines.map((u) => u.participantKey)).toEqual(['A', 'UNK', 'A']);
  const [ann, held] = lines as [(typeof lines)[0], (typeof lines)[0]];
  expect(l1.some((s) => s.includes(ann.text))).toBe(true);
  expect(l1.some((s) => s.includes(held.text))).toBe(false);
  expect(turns(log).find((t) => t.utteranceIds.includes(ann.id))?.participantKey).toBe('A');

  await runner.confirm(held.id, 'B');
  await sleep(150);
  expect(turns(log).find((t) => t.utteranceIds.includes(held.id))?.participantKey).toBe('B');
  expect(l1.some((s) => s.includes(held.text))).toBe(true);

  // Reload: a new runner and engine over the same log; Bo speaks clearly.
  e1.stop();
  await r1;
  await runner.stop();
  const again = make();
  const e2 = engine();
  const r2 = e2.run();
  await sleep(50);
  await speak(again, 30_000, 300, [{ from: 50, to: 150, d0c0: 0.03, d0c1: 0.3 }]);
  await sleep(150);
  e2.finishSource();
  await r2;
  const bo = finals(log).at(-1)!;
  expect(bo.participantKey).toBe('B');
  expect(turns(log).find((t) => t.utteranceIds.includes(bo.id))?.participantKey).toBe('B');
  expect(l1.some((s) => s.includes(bo.text))).toBe(true);
  const ids = turns(log).map((t) => t.turnId);
  expect(new Set(ids).size).toBe(ids.length);
}, 15_000);
