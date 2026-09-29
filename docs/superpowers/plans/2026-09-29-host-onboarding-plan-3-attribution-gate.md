# Host Onboarding, Plan 3: The Attribution Quality Gate and the Field Checks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure speaker attribution for every audio setup on real Anti-Debate recordings, calibrate each setup's auto-accept threshold so that wrongly auto-accepted speech stays at or below 2%, and publish the numbers.

**Architecture:**
- A Python generator (`services/capture`) turns each fixture's reference-labelled audio into three scenarios:
  - **tracks:** one file per speaker, masked from the mix by the reference turns;
  - **bleed:** tracks with the other speakers mixed in at −15 dB;
  - **mono:** the original mix.
- A dev-only page `/host/lab` runs the *shipping* browser code on a scenario, headless in Chrome through Playwright: diarization and voice matching (sherpa bundle), `EnergyVad`, `Attributor`, fusion and `buildUtterances`. ASR is stubbed: attribution is scored on time spans, not words.
- A TypeScript scorer compares the output with the reference and picks the threshold per setup.
- The chosen thresholds live in one module the attributor reads.

**Tech Stack:** Python (numpy, soundfile via uv), Playwright (Chromium), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-host-onboarding-design.md` §5 (quality gate), §10 (manual checks)

**Depends on:** Plans 1 and 2, complete.

## Global Constraints

- Plan 1 and 2 constraints apply (no API spend, no ontology change, UX §2 copy, commit trailer lines).
- **Measures** (spec §5):
  - share of speech time attributed to the right person;
  - share of speech time attributed to the wrong person *and auto-accepted*, which must be ≤ 2%.
- **Reference:** each fixture's `transcript.utterances.json` speaker turns mapped through `manifest.speakerMap`.
  - Unmapped labels are `UNK` (audience).
  - This reference is FluidAudio diarization plus Benjamin's confirmed speaker map, not a human gold set. Every published number says so.
- **The lab page is never reachable in production:** `/host/lab` returns 404 when `process.env.NODE_ENV === 'production'`.
- **Fixture media stays local** (gitignored). Scenario files go to `.data/scenarios/` (gitignored).

## Review Focus

1. **Reference `UNK` speech (audience questions).**
   - Attributing it to a debater counts as wrong.
   - Holding it, or labelling it `UNK`, counts as correct handling.
   - Test: Task 3.
2. **Speech the pipeline never emitted** (VAD missed it). It counts as *missed*, reported separately, never as correct. Test: Task 3.
3. **No threshold reaches ≤ 2% for a setup.**
   - The gate returns `threshold: 0.99` and `hostConfirmsAll: true`.
   - The setup screen says "speakers are confirmed by the host in this setup".
   - Test: Task 3 and Task 4.
4. **Overlapping reference turns.** Speech time counts once per reference speaker, and a prediction matching either overlapping speaker counts as correct. Test: Task 3.
5. **The lab route in a production build** returns 404. Test: Task 2.

---

### Task 1: Scenario generator

**Files:**
- Create: `services/capture/adl_capture/scenarios.py`, `services/capture/tests/test_scenarios.py`
- Modify: `services/capture/pyproject.toml` (`[project.scripts] adl-scenarios = "adl_capture.scenarios:main"`)

**Interfaces:**
- Produces:
  - `reference_turns(utterances_json: dict, speaker_map: dict[str, str]) -> list[tuple[int, int, str]]`: `(startMs, endMs, key)`, with unmapped labels → `"UNK"`
  - `make_tracks(mix: np.ndarray, sr: int, turns, keys: list[str], bleed_db: float | None) -> dict[str, np.ndarray]`
  - CLI: `uv run adl-scenarios --fixture ball-kokotajlo-ai-governance --minutes 20 --out ../../.data/scenarios/`
    - writes `<fixture>/{mono.wav, tracks/<key>.wav, bleed/<key>.wav, reference.json}`, 16 kHz mono float WAV;
    - takes the first N minutes after `programStartMs`;
    - `reference.json` = `{ turns: [[startMs, endMs, key]], participants: [{key, displayName, role}] }`, with times relative to the cut.

- [ ] **Step 1: Write the failing test**

```python
# services/capture/tests/test_scenarios.py
import numpy as np
from adl_capture.scenarios import make_tracks, reference_turns

def test_reference_turns_maps_labels_and_marks_audience_unknown():
    u = {"utterances": [{"speaker": "S1", "startMs": 0, "endMs": 1000}, {"speaker": "S9", "startMs": 1000, "endMs": 2000}]}
    assert reference_turns(u, {"S1": "B"}) == [(0, 1000, "B"), (1000, 2000, "UNK")]

def test_tracks_mask_other_speakers_and_bleed_adds_them_quietly():
    sr = 16000
    mix = np.ones(sr * 2, dtype=np.float32)
    turns = [(0, 1000, "A"), (1000, 2000, "B")]
    t = make_tracks(mix, sr, turns, ["A", "B"], bleed_db=None)
    assert t["A"][:sr].min() == 1.0 and np.abs(t["A"][sr:]).max() == 0.0
    b = make_tracks(mix, sr, turns, ["A", "B"], bleed_db=-15.0)
    assert np.isclose(b["A"][sr:].max(), 10 ** (-15 / 20), atol=1e-4)
```

- [ ] **Step 2: Run it and confirm it fails.** Run `cd services/capture && uv run pytest tests/test_scenarios.py -q`. Expected: FAIL, ImportError.

- [ ] **Step 3: Implement**

```python
# services/capture/adl_capture/scenarios.py
"""Attribution scenarios from reference-labelled fixtures (host-onboarding plan 3).

tracks: each speaker's reference turns masked out of the mix (what separate mics give).
bleed:  tracks plus every other speaker at bleed_db (what real separate mics give).
mono:   the mix itself (one room mic, or a video call's single feed).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[3]


def reference_turns(utterances_json: dict, speaker_map: dict[str, str]) -> list[tuple[int, int, str]]:
    return [(int(u["startMs"]), int(u["endMs"]), speaker_map.get(u["speaker"], "UNK")) for u in utterances_json["utterances"]]


def _mask(n: int, sr: int, turns, key: str) -> np.ndarray:
    m = np.zeros(n, dtype=np.float32)
    for s, e, k in turns:
        if k == key:
            m[int(s * sr / 1000) : int(e * sr / 1000)] = 1.0
    return m


def make_tracks(mix: np.ndarray, sr: int, turns, keys: list[str], bleed_db: float | None) -> dict[str, np.ndarray]:
    masks = {k: _mask(len(mix), sr, turns, k) for k in keys}
    out = {}
    for k in keys:
        own = mix * masks[k]
        if bleed_db is not None:
            others = np.clip(sum(masks[o] for o in keys if o != k), 0, 1) if len(keys) > 1 else 0
            own = own + mix * others * (10 ** (bleed_db / 20))
        out[k] = own.astype(np.float32)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--out", default=str(ROOT / ".data" / "scenarios"))
    a = ap.parse_args()
    fx = ROOT / "fixtures" / "antidebate" / a.fixture
    manifest = json.loads((fx / "manifest.json").read_text())
    mix, sr = sf.read(fx / "audio.16k.wav", dtype="float32")
    start = int(manifest.get("programStartMs", 0))
    end = start + int(a.minutes * 60_000)
    mix = mix[int(start * sr / 1000) : int(end * sr / 1000)]
    turns = [(max(0, s - start), min(end, e) - start, k) for s, e, k in reference_turns(json.loads((fx / "transcript.utterances.json").read_text()), manifest["speakerMap"]) if e > start and s < end]
    keys = sorted({k for _, _, k in turns if k != "UNK"})
    out = Path(a.out) / a.fixture
    for sub in ("tracks", "bleed"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    sf.write(out / "mono.wav", mix, sr, subtype="FLOAT")
    for sub, db in (("tracks", None), ("bleed", -15.0)):
        for k, pcm in make_tracks(mix, sr, turns, keys, db).items():
            sf.write(out / sub / f"{k}.wav", pcm, sr, subtype="FLOAT")
    roles = {p["key"]: "debater" for p in manifest["participants"]}
    participants = [{"key": k, "displayName": next((p["displayName"] for p in manifest["participants"] if p["key"] == k), k), "role": roles.get(k, "moderator")} for k in keys]
    (out / "reference.json").write_text(json.dumps({"turns": turns, "participants": participants}))
    print(f"{a.fixture}: {len(turns)} turns, speakers {keys} → {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests and generate the scenarios**

Run: `cd services/capture && uv run pytest tests/test_scenarios.py -q && for f in ball-kokotajlo-ai-governance belief-in-god open-source-ai; do uv run adl-scenarios --fixture $f --minutes 20; done`
Expected: 2 passed, and three scenario folders.

- [ ] **Step 5: Commit.** Message: "capture: attribution scenarios (tracks, bleed, mono) from reference-labelled fixtures".

---

### Task 2: The lab page and the headless harness

**Files:**
- Create:
  - `apps/web/app/host/lab/page.tsx`, `apps/web/app/host/lab/Lab.tsx`
  - `apps/web/app/api/dev/scenario/[...path]/route.ts`, which serves `.data/scenarios/**` in development only
  - `evals/attribution/run.ts` (Playwright script)
  - `apps/web/app/host/lab/lab.test.ts`

**Interfaces:**
- Consumes: Plan 1 (`DiarizeClient`, `buildUtterances`) and Plan 2 (`EnergyVad`, `rmsDb`, `Attributor`, `LiveRunner`, `buildMatchInput`/`matchVoices`, `speechSeconds`, `trimAnchor`).
- Produces:
  - `window.__adlLab.run({ fixture, setup: 'tracks'|'bleed'|'mono-live'|'mono-recording' })` → `Promise<{ utterances: { startMs; endMs; participantKey; confidence; pending }[]; seconds: number }>`.
  - The lab takes enrollment anchors from the first 30 s of each speaker's reference turns (as sound check would).
  - It feeds audio through the same code paths at maximum speed, frame by frame, without real time.
  - `mono-recording` uses whole-file diarization, then names each label by majority overlap with the anchors' reference speaker (simulating the host naming voices).
  - `evals/attribution/run.ts` launches Chromium on `http://localhost:3000/host/lab` with the host cookie, calls `run` for each fixture and setup, and writes `.data/scenarios/<fixture>/<setup>.result.json`.

- [ ] **Step 1: Write the failing test** (the production 404)

```ts
// apps/web/app/host/lab/lab.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

describe('/host/lab', () => {
  it('is not found in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: Page } = await import('./page');
    expect(() => Page()).toThrow('NEXT_NOT_FOUND');
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- lab`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `page.tsx` calls `notFound()` in production, else renders `<Lab/>`. The scenario route returns 404 in production, rejects any path containing `..`, and streams the file.
  - `Lab.tsx` sets `window.__adlLab` to the runner above. In the stubbed ASR, one word spans each VAD utterance: `[{ text: 'x', startMs, endMs }]`.
  - `run.ts` uses `@playwright/test`'s `chromium.launch()`, one page, sequential runs, and prints a line per run.

- [ ] **Step 4: Run it.**
  - Run the tests: `pnpm --filter @adl/web test -- lab`. Expected: PASS.
  - Then, with `pnpm dev` running: `pnpm tsx evals/attribution/run.ts`. Expected: 12 result files (3 fixtures × 4 setups).

- [ ] **Step 5: Commit.** Message: "evals: attribution lab runs the shipping browser code headless on scenarios".

---

### Task 3: Scorer and threshold calibration

**Files:**
- Create: `evals/attribution/score.ts`, `evals/attribution/score.test.ts`, `evals/attribution/report.ts`

**Interfaces:**
- Produces:
  - `score(reference: [number, number, string][], predicted: { startMs; endMs; participantKey; confidence; pending }[], threshold: number): { correct: number; wrongAuto: number; wrongHeld: number; held: number; missed: number }`. Each is a share of reference speech time, 0..1, at 10 ms resolution.
    - A prediction is *auto* when `!pending && confidence >= threshold`.
    - For reference `UNK` speech, a prediction of `UNK` or a held one counts as correct; an auto debater counts as `wrongAuto`.
  - `calibrate(runs, candidates = [0.85, 0.88, 0.9, 0.92, 0.95, 0.97, 0.99]): { threshold: number; hostConfirmsAll: boolean; atThreshold: ReturnType<typeof score> }`. It picks the lowest candidate whose `wrongAuto` ≤ 0.02 across all runs pooled. Without one: `{ threshold: 0.99, hostConfirmsAll: true }`.
  - `report.ts` reads the result files and writes:
    - `apps/web/lib/attribution/gate.json`: `{ tracks: {threshold, hostConfirmsAll}, call: …, room: …, recording: … }`. Map: tracks ← `bleed` results (the realistic case); call and room ← `mono-live`; recording ← `mono-recording`.
    - a Markdown section appended to `evals/results.md` with a table per setup (correct, wrongAuto, held, missed at the chosen threshold, the fixtures and minutes), stating the reference caveat from the Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
// evals/attribution/score.test.ts
import { describe, expect, it } from 'vitest';
import { calibrate, score } from './score';

const ref: [number, number, string][] = [[0, 1000, 'A'], [1000, 2000, 'B'], [2000, 3000, 'UNK']];

describe('score', () => {
  it('counts right, wrong-auto, held and missed as shares of reference speech', () => {
    const r = score(ref, [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 1000, endMs: 1500, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 2000, endMs: 3000, participantKey: 'A', confidence: 0.6, pending: true },
    ], 0.85);
    expect(r.correct).toBeCloseTo(2 / 3, 2);
    expect(r.wrongAuto).toBeCloseTo(1 / 6, 2);
    expect(r.missed).toBeCloseTo(1 / 6, 2);
  });
  it('overlapping reference speakers: matching either one is correct', () => {
    const r = score([[0, 1000, 'A'], [0, 1000, 'B']], [{ startMs: 0, endMs: 1000, participantKey: 'B', confidence: 1, pending: false }], 0.85);
    expect(r.wrongAuto).toBe(0);
  });
});

describe('calibrate', () => {
  it('falls back to host-confirms-all when no threshold is safe', () => {
    const bad = { reference: ref, predicted: [{ startMs: 0, endMs: 3000, participantKey: 'B', confidence: 1, pending: false }] };
    expect(calibrate([bad])).toMatchObject({ threshold: 0.99, hostConfirmsAll: true });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm vitest run evals/attribution`. If the root has no Vitest workspace entry for `evals/`, add `evals/package.json` (`@adl/evals`, a vitest devDependency, a test script) and run `pnpm --filter @adl/evals test`. Expected: FAIL.

- [ ] **Step 3: Implement** `score.ts` (10 ms bins: each bin's reference set vs its predicted label) and `calibrate`. Then implement `report.ts`.

- [ ] **Step 4: Run the tests, then the report.** Run `pnpm --filter @adl/evals test && pnpm tsx evals/attribution/report.ts`. Expected: PASS; `gate.json` is written; `evals/results.md` has the new section.

- [ ] **Step 5: Commit.** Message: "evals: attribution gate: scores per setup and calibrated auto-accept thresholds".

---

### Task 4: The attributor and setup screens read the gate

**Files:**
- Create: `apps/web/lib/attribution/gate.ts`, `apps/web/lib/attribution/gate.test.ts`
- Modify:
  - `apps/web/lib/attribution/attributor.ts` (threshold from the gate)
  - `apps/web/lib/recording/utterances.ts` (the recording threshold)
  - the setup screens (a label when `hostConfirmsAll`)

**Interfaces:**
- Produces: `gateFor(setup: 'tracks'|'call'|'room'|'recording'): { threshold: number; hostConfirmsAll: boolean }`, which reads `gate.json` with a fallback of `{threshold: 0.85, hostConfirmsAll: false}` when a key is missing.
  - The attributor's pending test becomes `fused < gateFor(setup).threshold`.
  - `buildUtterances` holds when `confidence < gateFor('recording').threshold`.
  - When `hostConfirmsAll`, the setup screen shows: "In this setup, the host confirms who is speaking before a line enters the map."

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/attribution/gate.test.ts
import { describe, expect, it } from 'vitest';
import { gateFor } from './gate';

describe('gateFor', () => {
  it('never lowers the threshold below 0.85', () => {
    for (const s of ['tracks', 'call', 'room', 'recording'] as const) expect(gateFor(s).threshold).toBeGreaterThanOrEqual(0.85);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- gate`. Expected: FAIL.
- [ ] **Step 3: Implement.** `gateFor` clamps to `max(0.85, value)`, then wire the attributor, `buildUtterances` and the screens.
- [ ] **Step 4: Run the whole web suite.** Run `pnpm --filter @adl/web test`. Expected: PASS. Existing attributor and utterance tests keep passing, because thresholds are ≥ 0.85 and the tests' confidences sit clearly above or below them. If a calibrated threshold flips an existing test's expectation, pin that test to `threshold: 0.85` with an explicit parameter rather than weakening the gate.
- [ ] **Step 5: Commit.** Message: "web: attribution thresholds come from the measured gate".

---

### Task 5: Browser transcription accuracy check, and the field checklist

**Files:**
- Create: `evals/asr/wer.ts`, `evals/asr/wer.test.ts`, `evals/asr/run.ts`
- Modify: `evals/results.md`, `docs/HOSTING.md` (the "Before your event" checklist), `docs/R0_DEMO.md`

**Interfaces:**
- Produces:
  - `wer(ref: string, hyp: string): number`: word-level Levenshtein over lowercase, punctuation-stripped tokens.
  - `run.ts` uses the lab page's real `AsrClient` (not stubbed) on five 60 s windows of `ball-kokotajlo-ai-governance/mono.wav`. It compares against the words of `transcript.utterances.json` in the same windows (FluidAudio/Parakeet reference) and reports the WER per window and the mean, plus the backend and real-time factor.

- [ ] **Step 1: Write the failing test**

```ts
// evals/asr/wer.test.ts
import { describe, expect, it } from 'vitest';
import { wer } from './wer';

describe('wer', () => {
  it('ignores case and punctuation', () => expect(wer('Taxes should fall.', 'taxes should fall')).toBe(0));
  it('counts one substitution in four words as 0.25', () => expect(wer('a b c d', 'a x c d')).toBe(0.25));
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/evals test -- wer`. Expected: FAIL.
- [ ] **Step 3: Implement** `wer.ts` and `run.ts`, then run `run.ts` with `pnpm dev` up, and append the results to `evals/results.md`.
- [ ] **Step 4: Write the field checklist** in `docs/HOSTING.md` → "Before your event". These are the manual checks from spec §10, each with how to do it and what "pass" means:
  - Scarlett L/R split in Chrome: meters move independently.
  - Two USB mics for 90 minutes: no drift above 100 ms at the end, checked by clapping once at the start and once at the end.
  - Chrome system audio on the host's macOS version.
  - The prepare page's speed factor on the host laptop: "2× or better for live".
  - A full 10-minute rehearsal on Stephanie's laptop.
- [ ] **Step 5: Commit.** Message: "evals: browser ASR accuracy check; docs: before-your-event checklist".

## Self-review

- **Spec coverage:**
  - §5 gate: three scenarios (T1); measured on the shipping code (T2); both measures and the ≤ 2% bar (T3); a failing setup keeps the host confirming (T3 and T4).
  - §10 manual checks: T5.
  - §11 risk "parakeet.js speed and accuracy": T5, plus Plan 1 T10's benchmark.
- **Types:**
  - `score` inputs match the lab output shape (T2).
  - `gate.json` keys match `gateFor`'s setups.
  - The `Setup` values from Plan 2 (`tracks|call|room`) plus `recording`.
- **Review Focus** tests: T3 (UNK, missed, no safe threshold, overlap) and T2 (the production 404).
