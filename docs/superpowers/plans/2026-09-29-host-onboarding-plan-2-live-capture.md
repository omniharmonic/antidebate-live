# Host Onboarding, Plan 2: Live Capture and Adaptive Speaker Attribution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host runs a live session from Chrome in any of three audio setups (separate mics, video call, one room mic). Every utterance is attributed from whatever signals exist, uncertain speakers are held for a one-click confirm, and the map builds live on `antidebate.xyz`.

**Architecture:** The live runner in the host tab:
- captures audio;
- splits it into per-channel utterances with an energy VAD;
- transcribes each utterance with the Plan 1 `AsrClient`;
- scores the voice against enrollment clips with the Plan 1 diarization bundle, by diarizing the anchor clips together with the utterance;
- fuses the channel and voice signals with a TypeScript port of `services/capture/adl_capture/fusion.py`;
- emits `utterance.final`, plus `attribution.pending` below 0.85.

`SessionEngine` gains a hold: pending utterances wait for `attribution.confirmed` before they reach the map. Recordings get the same hold, plus a "review unsure lines" step before analysis.

**Tech Stack:**
- Web Audio (`getUserMedia`, `getDisplayMedia`, `ChannelSplitterNode`, `AudioWorklet`)
- Plan 1's `AsrClient` and `DiarizeClient`, `@adl/engine`
- Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-09-29-host-onboarding-design.md` (§5, §6.1–6.3, §7 recovery, §8 screen 6, §9)

**Depends on:** Plan 1, complete. Uses:
- `HttpEventLog`, `SessionEngine`, `setCaller`/`browserCaller`
- `AsrClient`, `DiarizeClient`, `buildUtterances` types
- `/api/host/session`
- `HostBar`

## Global Constraints

- Global constraints of Plan 1 apply unchanged (model config in `models.ts` only; the key never reaches our server; audience surfaces only `audienceView()`; append-only log, pure reducers; no ontology change; UX §2 copy; `import type`; no API spend in tests; commit trailer lines).
- Fusion weights and threshold are copied from `services/capture/adl_capture/fusion.py`: channel 0.5 (margin dB / 12), voice 0.35, diarizer 0.15, overlap ×0.8, auto at ≥ 0.85.
- Adaptation thresholds (spec §5):
  - a dead channel is silent for 60 s while speech continues on another;
  - a swapped channel is 5 consecutive confident mismatches;
  - bleed is resolved by margin plus voice, and emitted once.
- Capture checks (spec §6.1):
  - `channelCount === 2` for the 2-input setup;
  - `echoCancellation`, `noiseSuppression` and `autoGainControl` all `false`.
- Enrollment is 20–30 s per person. Unmatched voices get the temporary label "Voice N".
- Nothing attributed below 0.85 reaches the map until the host confirms it (AGENTS non-negotiable 1; ONTOLOGY §8.5 spirit).

## Review Focus

1. **Host never confirms a pending line.** It must stay out of the map indefinitely, and must not block later turns. Test: Task 2.
2. **Both debaters talk at once on separate mics.** The result is two utterances, one per channel owner, each with overlap applied (×0.8). Neither is silently dropped. Test: Task 3.
3. **Tab audio stream ends** (the host closes the call tab or stops sharing). The runner shows "Audio stopped" with a Resume button. The session is not ended. Test: Task 6.
4. **Page reload mid-session.** On reopen, prior events hydrate, capture needs one click to restart, and enrollment anchors are restored from IndexedDB, so they aren't re-recorded. Test: Task 7.
5. **Enrollment clip that is mostly silence.** It is rejected with "We heard less than 10 seconds of speech from <name>. Record again." It is never stored as an anchor. Test: Task 5.

---

## File map

| File | Responsibility |
|---|---|
| `apps/web/lib/attribution/fusion.ts` | TS port of fusion.py. Pure. |
| `apps/web/lib/attribution/attributor.ts` | Per-utterance decision plus adaptation state (bleed, dead channel, swapped channel, discovery). Pure. |
| `packages/engine/src/engine.ts` | Hold pending utterances until confirmed (`holdPending`). |
| `apps/web/lib/live/vad.ts` | Energy VAD with an adaptive noise floor. Pure frame-in, segment-out. |
| `apps/web/lib/live/capture.ts` | Opens devices, tab or system audio; checks settings; streams per-channel frames via an AudioWorklet. |
| `apps/web/public/worklets/tap.js` | AudioWorklet that posts 16 kHz frames per channel. |
| `apps/web/lib/diarize/client.ts`, `apps/web/public/sherpa/diarize-worker.js` | Add `matchVoices(anchors, utterance)`. |
| `apps/web/lib/attribution/anchors.ts` | Maps anchor segments to labels to per-participant voice-match fractions. Pure. |
| `apps/web/lib/live/runner.ts` | Live orchestration: capture → VAD → ASR queue → match → fuse → events → engine. |
| `apps/web/app/host/new/setups/*` | Setup screens for mics, tab audio, room mic and enrollment. |
| `apps/web/app/host/s/[id]/LiveRunner.tsx`, `Unconfirmed.tsx`, `ReviewUnsure.tsx` | Live host view, the unconfirmed queue, and the recording review step. |

---

### Task 1: Fusion port

**Files:**
- Create: `apps/web/lib/attribution/fusion.ts`, `apps/web/lib/attribution/fusion.test.ts`

**Interfaces:**
- Produces:
  - `type Signals = { channelMarginDb: number | null; voiceMatch: number | null; diarizerAgrees: boolean | null; overlap: boolean }`
  - `fuse(s: Signals): number`, rounded to 3 decimals
  - `needsOperator(c: number, threshold?: number): boolean`
  - `AUTO_THRESHOLD = 0.85`
  - `voiceMatch` is already on the 0..1 scale that fusion.py derives from voiceprint similarity (Ruling: Python maps cosine similarity with `(s-0.4)/0.4`. The browser voice signal is an anchor-share fraction in 0..1, so it enters after that transform. The weight 0.35 is unchanged).

- [ ] **Step 1: Write the failing test** (the cases mirror `services/capture/tests/test_merge_fusion.py`)

```ts
// apps/web/lib/attribution/fusion.test.ts
import { describe, expect, it } from 'vitest';
import { AUTO_THRESHOLD, fuse, needsOperator } from './fusion';

// fusion.py maps voiceprint cosine s to (s-0.4)/0.4; the Python cases use s=0.82 → 1.0 and s=0.55 → 0.375.
describe('fuse (parity with fusion.py)', () => {
  it('clean channel + voice + diarizer agree → auto', () => {
    const c = fuse({ channelMarginDb: 14, voiceMatch: 1, diarizerAgrees: true, overlap: false });
    expect(c).toBe(1);
    expect(needsOperator(c)).toBe(false);
  });
  it('weak margin, weak voice, overlap → operator', () => {
    const c = fuse({ channelMarginDb: 2, voiceMatch: 0.375, diarizerAgrees: null, overlap: true });
    expect(c).toBe(0.202);
    expect(needsOperator(c)).toBe(true);
  });
  it('no signals → 0', () => expect(fuse({ channelMarginDb: null, voiceMatch: null, diarizerAgrees: null, overlap: false })).toBe(0));
  it('voice only, strong → auto; threshold is 0.85', () => {
    expect(fuse({ channelMarginDb: null, voiceMatch: 0.9, diarizerAgrees: null, overlap: false })).toBe(0.9);
    expect(AUTO_THRESHOLD).toBe(0.85);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- fusion`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/attribution/fusion.ts
/**
 * Attribution fusion, ported from services/capture/adl_capture/fusion.py (ARCHITECTURE §2.1 step 8).
 * Same weights and threshold. `voiceMatch` is already on the 0..1 score scale.
 */
export const AUTO_THRESHOLD = 0.85;

export type Signals = { channelMarginDb: number | null; voiceMatch: number | null; diarizerAgrees: boolean | null; overlap: boolean };

const clip = (x: number) => Math.max(0, Math.min(1, x));

export function fuse(s: Signals): number {
  const parts: [number, number][] = [];
  if (s.channelMarginDb !== null) parts.push([0.5, clip(s.channelMarginDb / 12)]);
  if (s.voiceMatch !== null) parts.push([0.35, clip(s.voiceMatch)]);
  if (s.diarizerAgrees !== null) parts.push([0.15, s.diarizerAgrees ? 1 : 0]);
  if (!parts.length) return 0;
  let score = parts.reduce((n, [w, v]) => n + w * v, 0) / parts.reduce((n, [w]) => n + w, 0);
  if (s.overlap) score *= 0.8;
  return Math.round(clip(score) * 1000) / 1000;
}

export const needsOperator = (c: number, threshold = AUTO_THRESHOLD) => c < threshold;
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- fusion`. Expected: PASS (4).

- [ ] **Step 5: Commit** — `git add apps/web/lib/attribution && git commit -m "web: attribution fusion ported from the capture service"`, with the trailer lines.

---

### Task 2: The engine holds unconfirmed speakers

**Files:**
- Modify: `packages/engine/src/engine.ts`
- Test: `packages/engine/src/engine.test.ts` (add cases)

**Interfaces:**
- Produces: `EngineOptions.holdPending?: boolean` (default `true`).

Behaviour when true:
- An `utterance.final` whose id is in `state.pendingAttribution` at ingest time is parked, not pushed to the `TurnBuffer`.
- On `attribution.confirmed` for a parked id, the utterance, with the confirmed participant from state, is pushed to the buffer.
- Parked utterances never block later turns. When the source finishes, they are discarded; they never enter the map.
- The engine ingests events in log order, so `attribution.pending` must be appended **before** its `utterance.final`. `buildUtterances` (Plan 1) currently appends it after, and the order must be swapped there. The test covers both the swap and the hold.

- [ ] **Step 1: Write the failing tests** (append to `packages/engine/src/engine.test.ts`, reusing its `MemLog`, `utt` and `sid` helpers)

```ts
describe('holdPending', () => {
  const start = (id: string): DomainEvent => ({ eventId: `${id}:start`, sessionId: id, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } });
  const pending = (id: string, uttId: string): DomainEvent => ({ eventId: `${id}:${uttId}:pending`, sessionId: id, type: 'attribution.pending', actor: 'system', mediaMs: 0, wallTs: w, payload: { utteranceId: uttId, candidates: {} } });

  it('a pending line never reaches L1 unless confirmed, and does not block later turns', async () => {
    const seen: string[] = [];
    setCaller(async (c) => { seen.push(c.input); return { ok: false, reason: 'provider_error', detail: 'x', log: { pass: c.pass } as never }; });
    const log = new MemLog();
    await log.append([start(sid), pending(sid, 'u1'), utt('u1', 'UNK', 0, 'Unsure speaker line.'), utt('u2', 'B', 3000, 'Bo speaks clearly here.')]);
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    expect(seen.some((s) => s.includes('Unsure speaker line.'))).toBe(false);
    expect(seen.some((s) => s.includes('Bo speaks clearly here.'))).toBe(true);
  });

  it('a confirmed line is processed as the confirmed speaker', async () => {
    const seen: string[] = [];
    setCaller(async (c) => { seen.push(c.input); return { ok: false, reason: 'provider_error', detail: 'x', log: { pass: c.pass } as never }; });
    const log = new MemLog();
    await log.append([start(sid), pending(sid, 'u1'), utt('u1', 'UNK', 0, 'Ann said this.'),
      { eventId: `${sid}:u1:confirm`, sessionId: sid, type: 'attribution.confirmed', actor: 'operator', mediaMs: 2000, wallTs: w, payload: { utteranceId: 'u1', participantKey: 'A' } }]);
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    expect(seen.some((s) => s.includes('Ann said this.'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/engine test`. Expected: the first new test FAILs, because the unsure line reaches L1 (the UNK role is skipped, but a best-guess debater is not). If it passes because `UNK` has no role, change `utt('u1','UNK',…)` in test 1 to `utt('u1','A',…)`, the best-guess case, and confirm it FAILs.

- [ ] **Step 3: Implement.** In `SessionEngine`:
  - add `private parked = new Map<string, Utterance>()` (import `type Utterance` from `@adl/ontology`);
  - add `holdPending: true` to the defaults;
  - replace the `utterance.final` branch in `ingest` with:

```ts
if (e.type === 'utterance.final') {
  this.lastUtteranceWall = Date.now();
  const u = e.payload.utterance;
  if (this.opts.holdPending && this.state.pendingAttribution.has(u.id)) {
    this.parked.set(u.id, u);
    continue;
  }
  for (const t of this.buffer.push(u)) this.queue.push(t);
}
if (e.type === 'attribution.confirmed' && this.parked.has(e.payload.utteranceId)) {
  const u = this.state.utterances.get(e.payload.utteranceId)!; // reducer already applied the confirmed speaker
  this.parked.delete(u.id);
  this.lastUtteranceWall = Date.now();
  for (const t of this.buffer.push(u)) this.queue.push(t);
}
```

Also swap the order in `apps/web/lib/recording/utterances.ts` so the `attribution.pending` event is pushed **before** its `utterance.final`, and update that file's test expectations if they assert order. A confirmed line arriving late lands in the next turn by media time. `TurnBuffer.push` must accept it. If `TurnBuffer` rejects out-of-order `startMs`, report DONE_WITH_CONCERNS with the observed behaviour rather than changing `TurnBuffer`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/engine test && pnpm --filter @adl/web test -- utterances`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: "engine: hold unconfirmed speakers until the host confirms".

---

### Task 3: The attributor, with adaptation

**Files:**
- Create: `apps/web/lib/attribution/attributor.ts`, `apps/web/lib/attribution/attributor.test.ts`

**Interfaces:**
- Consumes: Task 1 (`fuse`, `AUTO_THRESHOLD`).
- Produces:

```ts
export type Setup = 'tracks' | 'call' | 'room';
export type ChannelMap = Record<string, string>;            // channel id → participant key
export type UtteranceSignals = {
  channel: string | null;                                    // capture channel the utterance was cut from
  channelRmsDb: Record<string, number>;                      // every channel's RMS over the utterance span
  voice: Record<string, number>;                             // participant key → voice-match fraction 0..1 (may be empty)
  overlap: boolean;
  startMs: number; endMs: number;
};
export type Decision = { participantKey: string; confidence: number; pending: boolean; signals: { channel?: string; voiceprint?: Record<string, number> }; drop?: 'bleed' };
export type Notice = { kind: 'dead_channel' | 'swap_suggested' | 'new_voice'; channel?: string; participantKey?: string; label?: string };
export class Attributor {
  constructor(setup: Setup, channels: ChannelMap);
  decide(s: UtteranceSignals): { decision: Decision; notices: Notice[] };
  /** Called once per second with the current per-channel speech activity. */
  tick(nowMs: number, active: Record<string, boolean>): Notice[];
  applySwap(a: string, b: string): void;
}
```

Rules:
- **Channel owner** = `channels[s.channel]`. Channel margin = own channel RMS minus the loudest other channel, in dB.
- **Bleed:**
  - If another channel is ≥ 6 dB louder over the same span, this utterance is the bleed copy → `drop: 'bleed'`, and no event is emitted.
  - If the margin is within ±6 dB and `voice` names the other owner more strongly by ≥ 0.2, attribute to the voice's pick with `channelMarginDb: null`.
- **Voice** = `voice[candidate]`, where the candidate is the channel owner or the best voice match. `diarizerAgrees` = the best voice match equals the channel owner (null without a channel owner or without voice).
- **No channel owner** (call or room): the best voice match is the candidate.
  - If the best match is below 0.5, the result is `UNK`, pending, with a `new_voice` notice labelled `Voice N`. The same unmatched voice reuses its label; label identity is tracked by the caller via the `voice` record, which carries `Voice N` keys once the host names nothing.
- **Pending** = `fuse(...) < 0.85`.
- **Dead channel:** `tick` finds a channel inactive for ≥ 60 000 ms while any other channel was active in that window → one `dead_channel` notice per channel. That channel's owner is then attributed by voice alone: its `channelMarginDb` is ignored from then on.
- **Swap:** 5 consecutive decisions where the channel owner ≠ the best voice match, with the voice match ≥ 0.7 → one `swap_suggested {channel, participantKey: best}` notice.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/attribution/attributor.test.ts
import { describe, expect, it } from 'vitest';
import { Attributor, type UtteranceSignals } from './attributor';

const sig = (o: Partial<UtteranceSignals>): UtteranceSignals => ({ channel: 'L', channelRmsDb: { L: -20, R: -40 }, voice: {}, overlap: false, startMs: 0, endMs: 2000, ...o });

describe('Attributor, separate tracks', () => {
  const a = () => new Attributor('tracks', { L: 'A', R: 'B' });
  it('clean own channel → owner, auto', () => {
    const { decision } = a().decide(sig({}));
    expect(decision).toMatchObject({ participantKey: 'A', pending: false });
  });
  it('bleed copy on the quieter channel is dropped, not emitted twice', () => {
    const { decision } = a().decide(sig({ channel: 'R', channelRmsDb: { L: -18, R: -30 } }));
    expect(decision.drop).toBe('bleed');
  });
  it('both talking at once: each channel keeps its owner, overlap lowers confidence', () => {
    const at = a();
    const l = at.decide(sig({ channel: 'L', channelRmsDb: { L: -20, R: -22 }, overlap: true, voice: { A: 0.9 } })).decision;
    const r = at.decide(sig({ channel: 'R', channelRmsDb: { L: -22, R: -20 }, overlap: true, voice: { B: 0.9 } })).decision;
    expect([l.participantKey, r.participantKey]).toEqual(['A', 'B']);
    expect(l.drop).toBeUndefined();
    expect(r.drop).toBeUndefined();
  });
  it('a dead channel is reported once and its owner falls back to voice', () => {
    const at = a();
    const n1 = at.tick(0, { L: false, R: true });
    const n2 = at.tick(61_000, { L: false, R: true });
    const n3 = at.tick(62_000, { L: false, R: true });
    expect([...n1, ...n2, ...n3].filter((n) => n.kind === 'dead_channel')).toEqual([{ kind: 'dead_channel', channel: 'L', participantKey: 'A' }]);
  });
  it('five confident mismatches suggest swapping the channel', () => {
    const at = a();
    let notices: unknown[] = [];
    for (let i = 0; i < 5; i++) notices = [...notices, ...at.decide(sig({ voice: { B: 0.8, A: 0.1 } })).notices];
    expect(notices).toContainEqual({ kind: 'swap_suggested', channel: 'L', participantKey: 'B' });
  });
});

describe('Attributor, one mixed feed', () => {
  it('strong voice match → that person; weak → UNK pending with a new voice notice', () => {
    const at = new Attributor('room', {});
    expect(at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.92, B: 0.05 } })).decision).toMatchObject({ participantKey: 'A', pending: false });
    const weak = at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.3, B: 0.2 } }));
    expect(weak.decision).toMatchObject({ participantKey: 'UNK', pending: true });
    expect(weak.notices[0]).toMatchObject({ kind: 'new_voice', label: 'Voice 1' });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/web test -- attributor`. Expected: FAIL.

- [ ] **Step 3: Implement** `attributor.ts` to the rules above:
  - Keep all state (dead set, last-active times per channel, mismatch streak per channel, voice label counter) inside the class.
  - `decide` computes `margin = own - max(others)`:
    - if `margin <= -6` → return `drop: 'bleed'`;
    - with a dead owner, set margin to `null`.
  - The candidate follows the bleed and voice rules above.
  - `confidence = fuse({channelMarginDb: margin, voiceMatch: voice[candidate] ?? null, diarizerAgrees, overlap})`. For `UNK`, confidence is `min(0.6, fused)`.
  - `signals = { channel: s.channel ?? undefined, voiceprint: s.voice }`, with keys omitted when empty.
  - In the "voice picks the other owner" branch, `channelMarginDb` is null, so the voice-only fusion applies.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- attributor`. Expected: PASS (6).

- [ ] **Step 5: Commit.** Message: "web: attributor combines channel and voice, adapts to bleed, dead and swapped mics".

---

### Task 4: Energy VAD and the capture layer

**Files:**
- Create:
  - `apps/web/lib/live/vad.ts`, `apps/web/lib/live/vad.test.ts`
  - `apps/web/lib/live/capture.ts`, `apps/web/lib/live/capture.test.ts`
  - `apps/web/public/worklets/tap.js`

**Interfaces:**
- Produces:
  - `class EnergyVad`, with `constructor(opts?: { frameMs?: 20; hangoverMs?: 700; minSpeechMs?: 400; maxUtteranceMs?: 15000; marginDb?: 10 })` and `push(frame: Float32Array, atMs: number): { startMs: number; endMs: number; pcm: Float32Array } | null`
    - The noise floor is the 10th percentile of the last 5 s of frame dB.
    - Speech is a frame more than `marginDb` above the floor.
    - An utterance closes after `hangoverMs` of non-speech, or at `maxUtteranceMs`.
  - `rmsDb(pcm: Float32Array): number`
  - `checkTrackSettings(s: MediaTrackSettings, want: { channels: 1 | 2 }): string[]`: plain-sentence problems, empty when fine
  - `openMicDevice(deviceId: string, channels: 1 | 2): Promise<MediaStream>`: constraints `{ deviceId: {exact}, channelCount: {ideal: channels}, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: {ideal: 48000} }`
  - `openTabAudio(): Promise<MediaStream>`: `getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include' })`. Stops the video track; throws `NoAudioShared` if there is no audio track. The message: "The shared tab had no audio. Share again and tick “Share tab audio”."
  - `tapChannels(stream: MediaStream, onFrame: (channel: number, frame: Float32Array, atMs: number) => void): Promise<() => void>`: AudioWorklet `tap.js` resamples to 16 kHz and posts 20 ms frames per channel. Returns a stop function. The media clock starts at 0 when the tap starts.
  - `onStreamEnded(stream, cb)`: fires when every audio track ends.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/live/vad.test.ts
import { describe, expect, it } from 'vitest';
import { EnergyVad, rmsDb } from './vad';

const frame = (amp: number) => Float32Array.from({ length: 320 }, (_, i) => amp * Math.sin(i / 3));

describe('EnergyVad', () => {
  it('cuts one utterance from speech between silences', () => {
    const v = new EnergyVad();
    const out = [];
    let t = 0;
    for (let i = 0; i < 150; i++, t += 20) { const r = v.push(frame(0.001), t); if (r) out.push(r); } // 3 s floor
    for (let i = 0; i < 100; i++, t += 20) { const r = v.push(frame(0.2), t); if (r) out.push(r); }  // 2 s speech
    for (let i = 0; i < 60; i++, t += 20) { const r = v.push(frame(0.001), t); if (r) out.push(r); }  // 1.2 s silence
    expect(out).toHaveLength(1);
    expect(out[0]!.startMs).toBe(3000);
    expect(out[0]!.endMs).toBeGreaterThanOrEqual(5000);
    expect(out[0]!.pcm.length).toBeGreaterThan(16_000 * 1.9);
  });
  it('ignores a click shorter than minSpeechMs', () => {
    const v = new EnergyVad();
    let t = 0, n = 0;
    for (let i = 0; i < 150; i++, t += 20) if (v.push(frame(0.001), t)) n++;
    for (let i = 0; i < 5; i++, t += 20) if (v.push(frame(0.5), t)) n++;
    for (let i = 0; i < 60; i++, t += 20) if (v.push(frame(0.001), t)) n++;
    expect(n).toBe(0);
  });
  it('rmsDb of silence is very low', () => expect(rmsDb(new Float32Array(320))).toBeLessThan(-90));
});
```

```ts
// apps/web/lib/live/capture.test.ts
import { describe, expect, it } from 'vitest';
import { checkTrackSettings } from './capture';

describe('checkTrackSettings', () => {
  it('passes a clean 2-channel interface', () => {
    expect(checkTrackSettings({ channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, { channels: 2 })).toEqual([]);
  });
  it('explains each problem in a sentence', () => {
    expect(checkTrackSettings({ channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true }, { channels: 2 })).toEqual([
      'This device gives one channel, so both mics are mixed together. Choose the 2-input interface, or use the one-mic setup.',
      'The browser is cleaning up the audio (echo cancellation), which hurts transcription. Reload the page and allow the microphone again.',
      'The browser is adjusting the volume automatically, which hurts transcription. Reload the page and allow the microphone again.',
    ]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/web test -- vad capture`. Expected: FAIL.

- [ ] **Step 3: Implement.** `vad.ts` has no browser APIs. In `capture.ts`, only `checkTrackSettings` is unit-tested. The rest is browser-only; keep it thin.

`tap.js`:

```js
// apps/web/public/worklets/tap.js — posts 20 ms, 16 kHz frames per input channel.
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = []; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    input.forEach((ch, c) => {
      const acc = (this.acc[c] ||= { pos: 0, out: [] });
      for (; acc.pos < ch.length; acc.pos += this.ratio) acc.out.push(ch[Math.floor(acc.pos)]);
      acc.pos -= ch.length;
      while (acc.out.length >= 320) this.port.postMessage({ channel: c, frame: Float32Array.from(acc.out.splice(0, 320)) });
    });
    return true;
  }
}
registerProcessor('tap', Tap);
```

In `tapChannels`:
- create `new AudioContext()`;
- `await ctx.audioWorklet.addModule('/worklets/tap.js')`;
- use a source from the stream and an `AudioWorkletNode(ctx, 'tap', { channelCount: n, channelCountMode: 'explicit', numberOfInputs: 1 })`, with `n` from `track.getSettings().channelCount ?? 1`;
- count frames per channel: `atMs = frames[c] * 20`.

The stop function disconnects and closes the context.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- vad capture`. Expected: PASS (5).

- [ ] **Step 5: Commit.** Message: "web: live capture (mics, tab audio) and an energy VAD".

---

### Task 5: Voice matching against enrollment anchors

**Files:**
- Modify: `apps/web/public/sherpa/diarize-worker.js` (a `match` message), `apps/web/lib/diarize/client.ts` (`matchVoices`)
- Create: `apps/web/lib/attribution/anchors.ts`, `apps/web/lib/attribution/anchors.test.ts`

**Interfaces:**
- Produces:
  - `type Anchor = { key: string; pcm: Float32Array }` (16 kHz, 8–10 s of that person's speech)
  - `buildMatchInput(anchors: Anchor[], utterance: Float32Array): { samples: Float32Array; spans: { key: string | '__utt__'; startMs: number; endMs: number }[] }`: concatenates anchor₁, 0.5 s silence, anchor₂ … then the utterance
  - `scoreFromSegments(segments: SpeakerSegment[], spans): Record<string, number>`:
    1. each anchor's label is the majority label over its span;
    2. for each anchor key, the score is the share of the utterance span's speech time whose label equals that anchor's label;
    3. keys whose anchor label is shared with another anchor get 0 (ambiguous).
  - `DiarizeClient.matchVoices(anchors, utterance): Promise<Record<string, number>>`, with `numClusters = anchors.length + 1`, so an unknown voice can form its own cluster
  - `speechSeconds(pcm: Float32Array): number`: speech duration from `EnergyVad`. Enrollment requires ≥ 10 s. The error: "We heard less than 10 seconds of speech from <name>. Record again."
  - `trimAnchor(pcm: Float32Array, maxMs = 10_000): Float32Array`: keeps the loudest 10 s of speech frames

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/attribution/anchors.test.ts
import { describe, expect, it } from 'vitest';
import { buildMatchInput, scoreFromSegments, speechSeconds } from './anchors';

const sec = (s: number, amp = 0.2) => Float32Array.from({ length: 16_000 * s }, (_, i) => amp * Math.sin(i / 3));

describe('buildMatchInput', () => {
  it('lays out anchors, gaps and the utterance with media spans', () => {
    const { samples, spans } = buildMatchInput([{ key: 'A', pcm: sec(2) }, { key: 'B', pcm: sec(2) }], sec(1));
    expect(spans).toEqual([{ key: 'A', startMs: 0, endMs: 2000 }, { key: 'B', startMs: 2500, endMs: 4500 }, { key: '__utt__', startMs: 5000, endMs: 6000 }]);
    expect(samples.length).toBe(16_000 * 6);
  });
});

describe('scoreFromSegments', () => {
  const spans = [{ key: 'A', startMs: 0, endMs: 2000 }, { key: 'B', startMs: 2500, endMs: 4500 }, { key: '__utt__' as const, startMs: 5000, endMs: 6000 }];
  it('scores the share of the utterance on each anchor’s label', () => {
    const segs = [{ startMs: 0, endMs: 2000, label: 'S0', confidence: 1 }, { startMs: 2500, endMs: 4500, label: 'S1', confidence: 1 }, { startMs: 5000, endMs: 5800, label: 'S1', confidence: 1 }, { startMs: 5800, endMs: 6000, label: 'S2', confidence: 1 }];
    expect(scoreFromSegments(segs, spans)).toEqual({ A: 0, B: 0.8 });
  });
  it('two anchors on one label are ambiguous → both 0', () => {
    const segs = [{ startMs: 0, endMs: 4500, label: 'S0', confidence: 1 }, { startMs: 5000, endMs: 6000, label: 'S0', confidence: 1 }];
    expect(scoreFromSegments(segs, spans)).toEqual({ A: 0, B: 0 });
  });
});

describe('speechSeconds', () => {
  it('counts speech, not silence', () => {
    const pcm = new Float32Array(16_000 * 20);
    pcm.set(sec(6), 16_000 * 3);
    expect(speechSeconds(pcm)).toBeGreaterThan(5);
    expect(speechSeconds(pcm)).toBeLessThan(7.5);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/web test -- anchors`. Expected: FAIL.

- [ ] **Step 3: Implement** `anchors.ts`, reusing `EnergyVad` from Task 4 for `speechSeconds` and `trimAnchor`. The worker `match` message runs the same `sd.process` with `numClusters = anchors + 1`, and returns segments. The client composes `buildMatchInput`, then the worker, then `scoreFromSegments`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- anchors`. Expected: PASS (4).

- [ ] **Step 5: Measure latency by hand.** On `/host/prepare`, in the console:
  - take two 10 s anchors cut from a fixture;
  - add a 4 s utterance from a known speaker;
  - time `matchVoices`.

  Record the wall time and whether the right key wins in `evals/results.md` under "Live voice match". Above 3 s on Benjamin's laptop: report DONE_WITH_CONCERNS with the number.

- [ ] **Step 6: Commit.** Message: "web: live voice matching against enrollment clips, using the diarization bundle".

---

### Task 6: The live runner

**Files:**
- Create:
  - `apps/web/lib/live/runner.ts`, `apps/web/lib/live/runner.test.ts`
  - `apps/web/lib/live/anchors-store.ts` (IndexedDB: anchors and setup per session, via Plan 1's `idbCheckpoint` pattern with keys `anchors` and `setup`)

**Interfaces:**
- Consumes: Tasks 1–5; Plan 1 `AsrClient.transcribe`, `HttpEventLog`, `SessionEngine`.
- Produces:
  - `type LiveSetup = { kind: Setup; channels: ChannelMap; participants: {key: string; displayName: string}[] }`
  - `class LiveRunner`, with:
    - `constructor(o: { sessionId; setup: LiveSetup; anchors: Anchor[]; asr: Pick<AsrClient,'transcribe'>; voices: { matchVoices(a: Anchor[], u: Float32Array): Promise<Record<string, number>> }; log: EventLog; onStatus(s: LiveStatus): void })`
    - `onUtterance(channel: string, u: { startMs; endMs; pcm }, rms: Record<string, number>, overlap: boolean): Promise<void>`
    - `confirm(utteranceId: string, participantKey: string): Promise<void>`: appends `attribution.confirmed` with actor `operator`
    - `tick(nowMs, active)`
    - `stop(): Promise<void>`: appends nothing. Ending the session is the engine's `finishSource()`.
  - `type LiveStatus = { audio: 'ok' | 'stopped'; queue: number; lastLatencyMs: number | null; notices: Notice[]; unconfirmed: { utteranceId: string; text: string; candidates: Record<string, number> }[] }`

Flow per VAD utterance:
1. queue it (ASR runs one at a time);
2. `words = await asr.transcribe(pcm, startMs)`, and skip if empty;
3. `voice = setup.kind === 'tracks' && rms margin ≥ 12 dB ? {} : await voices.matchVoices(anchors, pcm)` (saves latency when a channel is unambiguous);
4. `attributor.decide(...)`, and skip if `drop`;
5. append `attribution.pending` (if pending) and then `utterance.final`, id `u<channel>-<startMs>`, `signals` from the decision, `confirmedBy: 'auto'`;
6. publish status, including `lastLatencyMs` = now minus the utterance's end wall time.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/live/runner.test.ts
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { LiveRunner } from './runner';

class Mem { kind = 'http' as const; where = 'mem'; events: DomainEvent[] = []; async append(e: DomainEvent[]) { this.events.push(...e); } async read(c: number) { return { cursor: this.events.length, events: this.events.slice(c) }; } async logCall() {} }
const pcm = new Float32Array(16_000);

describe('LiveRunner', () => {
  it('emits pending before final for an unsure voice, and a confirm releases it', async () => {
    const log = new Mem();
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [{ key: 'A', displayName: 'Ann' }] }, anchors: [],
      asr: { transcribe: async (_p, off) => [{ text: 'Hello', startMs: off, endMs: off + 400 }] },
      voices: { matchVoices: async () => ({ A: 0.3 }) }, log, onStatus: () => {},
    });
    await r.onUtterance('mono', { startMs: 1000, endMs: 2000, pcm }, {}, false);
    expect(log.events.map((e) => e.type)).toEqual(['attribution.pending', 'utterance.final']);
    const id = (log.events[1] as Extract<DomainEvent, { type: 'utterance.final' }>).payload.utterance.id;
    await r.confirm(id, 'A');
    expect(log.events.at(-1)).toMatchObject({ type: 'attribution.confirmed', actor: 'operator', payload: { utteranceId: id, participantKey: 'A' } });
  });
  it('drops a bleed copy and skips voice matching on an unambiguous channel', async () => {
    const log = new Mem();
    let matched = 0;
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'tracks', channels: { L: 'A', R: 'B' }, participants: [] }, anchors: [],
      asr: { transcribe: async (_p, off) => [{ text: 'x', startMs: off, endMs: off + 300 }] },
      voices: { matchVoices: async () => { matched++; return {}; } }, log, onStatus: () => {},
    });
    await r.onUtterance('L', { startMs: 0, endMs: 1000, pcm }, { L: -18, R: -40 }, false);
    await r.onUtterance('R', { startMs: 0, endMs: 1000, pcm }, { L: -18, R: -32 }, false);
    expect(log.events.filter((e) => e.type === 'utterance.final')).toHaveLength(1);
    expect(matched).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- runner`. Expected: FAIL.

- [ ] **Step 3: Implement** `runner.ts` to the flow above, with a promise-chain queue for ASR. `anchors-store.ts` saves and loads `{ setup, anchors: {key, pcm: ArrayBuffer}[] }`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- runner`. Expected: PASS (2).

- [ ] **Step 5: Commit.** Message: "web: live runner: transcribe, match, attribute, hold the unsure".

---

### Task 7: Live setup screens, enrollment, rehearsal and the live host view

**Files:**
- Create:
  - `apps/web/app/host/new/setups/MicSetup.tsx`, `TabSetup.tsx`, `RoomSetup.tsx`, `Enrollment.tsx`, `Rehearsal.tsx`
  - `apps/web/app/host/s/[id]/LiveRunner.tsx`, `Unconfirmed.tsx`
- Modify:
  - `apps/web/app/host/new/HostNewForm.tsx` (enable the three live options)
  - `apps/web/app/host/s/[id]/Runner.tsx` (route by `source.kind`)
  - `apps/web/app/host/page.tsx` (enable "New live session")

**Interfaces:**
- Consumes: Tasks 3–6 (`openMicDevice`, `openTabAudio`, `checkTrackSettings`, `tapChannels`, `onStreamEnded`, `EnergyVad`, `rmsDb`, `speechSeconds`, `trimAnchor`, `LiveRunner`, anchors store); Plan 1 (`HttpEventLog`, `SessionEngine`, `setCaller(browserCaller(getKey()!))`, `AsrClient`, `DiarizeClient`, `HostBar`, `/api/host/session`).

Screens. The copy is final; keep it.

1. **MicSetup** ("Each speaker has their own mic"):
   1. "Plug the audio interface into this laptop. Put each debater's mic in its own input (debater 1 in input 1, debater 2 in input 2). Turn off any auto-gain or 'Air' setting on the interface."
   2. A device select (`enumerateDevices`, audioinput) and "Use this device". Opens the device with 2 channels and runs `checkTrackSettings`. Each problem is listed; "Continue" is disabled until the list is empty.
   3. Two meters labelled "Input 1" and "Input 2" (RMS from `tapChannels`). The prompt: "Ask each person to say their name. Choose who is speaking into each input." Beside each meter is a participant select. Continue needs every debater mapped to exactly one input.
   4. A warning box: "Some recorders (Zoom PodTrak, RØDECaster on a Mac) send one mixed signal over USB. If both meters move together whoever speaks, use the one-mic setup instead." More than 2 debaters: "Chrome can read two inputs from one device. For three or four people, plug in a second interface or separate USB mics and add them here." This allows adding a second device: each device is opened separately, and channel ids are `d<i>c<j>`.
2. **TabSetup** ("Video call"):
   1. "Join the call from a second Chrome window, muted, with your camera off. Name yourself 'Anti-Debate notes' so people know why you're there."
   2. "Choose Share tab audio, pick that call's tab, and make sure 'Share tab audio' is ticked." This calls `openTabAudio()`.
   3. The alternative for the Zoom desktop app: "If the call is in the Zoom app rather than a browser tab, choose Share system audio (Chrome on macOS 14.2 or later, or Windows)."
   4. The tip: "For a cleaner map afterwards, record the call with a separate audio file for each person (Zoom: Settings → Recording → 'Record a separate audio file for each participant'; Riverside and StreamYard do this by default) and process that recording here."
3. **RoomSetup** ("One mic in the room"):
   - "Put the laptop (or the one mic) between the speakers, facing them, away from any loudspeakers."
   - A device select (1 channel) and a meter.
4. **Enrollment** (every live setup). For each participant in turn:
   - "Ask <name> to talk for about 20 seconds: their name and what they hope to get from today."
   - A Record/Stop button and a meter.
   - Uses `speechSeconds` ≥ 10, else the error message from Task 5. Then `trimAnchor`.
   - For the tracks setup, enrollment is optional ("Recommended: lets the app double-check the mics").
   - Anchors are saved to the anchors store.
5. **Rehearsal:** "Talk for a moment to check the transcript." Runs the `LiveRunner` without an engine for 30 s into an in-memory log, and shows the lines with speaker names. "Looks right: start the session" goes to the session.
6. **LiveRunner.tsx (the live host view):**
   - A status line: "Listening · 2 inputs · transcript about N s behind", with N from `lastLatencyMs`, 1 decimal.
   - Notices as plain lines with actions:
     - dead channel: "Input 1 (Ann) has been silent for a minute while others speak. Ann will be identified by voice until it recovers.";
     - swap: "Input 1 sounds like Bo. Swap inputs 1 and 2?" with a Swap button (`applySwap`);
     - new voice: "A new voice is speaking (Voice 1). Name them?" with a select that confirms all pending lines of that label.
   - `Unconfirmed.tsx`: a list of pending lines with a play button (the utterance pcm kept in memory for 10 minutes) and speaker buttons → `confirm`.
   - Pause/Resume (stops and restarts the tap). End session → `engine.finishSource()` → "Ending…" → "Session ended. Open the map." A `beforeunload` warning while live.
   - Wake Lock (`navigator.wakeLock.request('screen')`, re-requested on `visibilitychange`). When hidden: "This tab is in the background. Keep it in front so capture isn't slowed."
   - Audio stream ends → the status shows "Audio stopped" and a "Resume audio" button that re-runs the same setup's open call.
   - After a reload: the page hydrates the log (`HttpEventLog.hydrate`), loads anchors and setup from the store, and shows "Click to resume listening" (browsers need a gesture).
   - The engine runs with `silenceMs: 3500`.

- [ ] **Step 1: Build the screens as described**, using the components and copy above. Keep each file under about 200 lines, with shared bits in `setups/` helpers.

- [ ] **Step 2: Add a Playwright test with fake devices** (Chrome flags feed a WAV as the mic)

```ts
// apps/web/e2e/live.spec.ts
import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.FAKE_AUDIO_WAV}`] } });

test('room-mic setup reaches enrollment and rejects a silent clip', async ({ page, context }) => {
  await context.addCookies([{ name: 'adl_host', value: process.env.HOST_COOKIE!, url: 'http://localhost:3000' }]);
  await page.addInitScript(() => localStorage.setItem('adl.anthropicKey', 'sk-ant-fake'));
  await page.goto('/host/new?kind=live');
  await page.getByLabel('Title').fill('E2E live');
  await page.getByLabel('Name', { exact: false }).first().fill('Ann');
  await page.getByText('One mic in the room').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Ask Ann to talk for about 20 seconds')).toBeVisible();
});
```

`FAKE_AUDIO_WAV`: 30 s of a fixture cut to 16 kHz mono WAV with ffmpeg. `HOST_COOKIE`: from `node -e` calling `signHostCookie` with the dev secret. Document both in the test file's header comment.

- [ ] **Step 3: Rehearse by hand on real hardware** (Benjamin's laptop, built-in mic, room setup): enroll two voices, speak alternately for 2 minutes, then check:
  - lines appear with names;
  - unsure lines queue;
  - confirming releases them into the map on `/s/<id>/console`;
  - the fake key produces "Analysis delayed" rather than a crash.

  Record the latency and the share of lines held in `evals/results.md` under "Live, room mic, 2 voices".

- [ ] **Step 4: Commit.** Message: "web: live setups (mics, video call, room), enrollment, rehearsal and the live host view".

---

### Task 8: Recordings: review unsure lines before analysis

**Files:**
- Create: `apps/web/app/host/s/[id]/ReviewUnsure.tsx`
- Modify:
  - `apps/web/lib/recording/pipeline.ts`: add the stage `{ kind: 'review'; pending: { utteranceId; text; startMs; endMs; candidates }[] }` between transcribing and analysing; `runRecording` takes `review?: (pending) => Promise<{ utteranceId: string; participantKey: string }[]>`
  - `apps/web/lib/recording/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 2 (`holdPending`), and Plan 1 `runRecording`.
- Produces:
  - Recordings emit `attribution.confirmed` for each line the host assigns, before the engine starts.
  - Unassigned lines stay pending and out of the map.
  - The screen reads: "N lines have an unsure speaker. Assign the ones you can; the rest stay out of the map." Each line has a play button and speaker buttons, with "Skip the rest" and "Continue".

- [ ] **Step 1: Write the failing test** (add to `pipeline.test.ts`)

```ts
it('asks the host about pending lines and confirms the ones they assign', async () => {
  const appended: DomainEvent[] = [];
  const checkpoint = memCheckpoint([0, 1, 2]);
  await checkpoint.putMeta({ fileName: 'f', fileSize: 1, durationMs: 130_000, segments: [], voiceMap: {} }); // no named voices → every line pending
  let asked = 0;
  await runRecording({
    sessionId: 's', file: new File([new Uint8Array(1)], 'f'), token: async () => 't',
    asr: { transcribe: async () => [] }, checkpoint, onStage: () => {},
    review: async (p) => { asked = p.length; return p.slice(0, 1).map((x) => ({ utteranceId: x.utteranceId, participantKey: 'A' })); },
    engine: { start: async () => {} },
    makeLog: () => ({ kind: 'http', where: 'm', append: async (e) => void appended.push(...e), read: async () => ({ cursor: 0, events: [] }), logCall: async () => {}, hydrate: async () => {}, close: async () => {} }),
  });
  expect(asked).toBe(3);
  expect(appended.filter((e) => e.type === 'attribution.confirmed')).toHaveLength(1);
});
```

(`memCheckpoint` chunks each hold one word, so three pending lines.) Add `import type { DomainEvent } from '@adl/core'` if it's missing.

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- pipeline`. Expected: FAIL.

- [ ] **Step 3: Implement.** Collect the pending ids from the appended events. When `review` is provided and the list is non-empty, emit the stage, await the answers, and append `attribution.confirmed` (actor `operator`, `mediaMs` = the utterance's `endMs`, eventId `${sessionId}:${utteranceId}:confirm`). Then `ReviewUnsure.tsx` is the UI, wired in `Runner.tsx`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- pipeline`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: "web: recordings ask the host about unsure speakers before analysis".

---

### Task 9: Host guide for live setups

**Files:**
- Modify: `docs/HOSTING.md` (sections for the three live setups, each with a hardware list and steps, plus the troubleshooting table rows for every message in Tasks 4–7), `docs/R0_DEMO.md` (event-day checklist: the interface and mic check, enrollment at sound check, "Prepare this laptop" the day before)

- [ ] **Step 1: Write the sections.** The hardware facts come only from `docs/research/2026-09-29-browser-audio-capture.md` and `2026-09-29-video-call-audio.md`: the Scarlett 2i2 L/R split, 2 channels maximum per device in Chrome, the PodTrak/RØDECaster caveat, system audio on macOS 14.2+ with Chrome 141+, and the listener tab. Nothing unverified.
- [ ] **Step 2: Commit.** Message: "docs: live hosting guide per audio setup".

## Self-review

- **Spec coverage:**
  - §5: channel (T3), voice (T5), discovery (T3 notices and T7 naming), fusion (T1), adaptation (T3 and T7 notices), recordings' hold (T2 and T8).
  - §6.1–6.3: T7.
  - §6 "every live setup": prepare (Plan 1), rehearsal (T7), wake lock and hidden-tab warning (T7).
  - §7 live-tab recovery: T7.
  - §9 mic, channel and stream errors: T4 and T7.
- **Types:**
  - `Signals` (T1) → the attributor (T3).
  - `Notice` and `Decision` (T3) → the runner (T6) and the UI (T7).
  - `Anchor` (T5) → the runner (T6) and the store.
  - `SpeakerSegment` from Plan 1 feeds `scoreFromSegments`.
- **Review Focus** tests: T2 (never confirmed), T3 (simultaneous speech), T7 (stream ended, reload: manual steps plus notices), T5 (silent enrollment).
