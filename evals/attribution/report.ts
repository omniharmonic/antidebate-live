// Scores the lab's result files, calibrates an auto-accept threshold per setup, writes
// apps/web/lib/attribution/gate.json and writes the "Attribution gate" section of evals/results.md
// (replacing the previous one).
//
//   pnpm tsx evals/attribution/report.ts
//
// Inputs: .data/scenarios/<fixture>/<setup>.result.json (from run.ts) and reference.json.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibrate, gatePred, MIN_SAMPLE, pooled, type Calibration, type LabPred, type Ref, type Run } from './score';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIOS = path.join(ROOT, '.data/scenarios');

type Result = { utterances: LabPred[]; windowMs: number; enrolled?: string[]; enrolledFromMs?: number };
type Loaded = { fixture: string; run: Run; minutes: number; enrolled: string[]; enrolledFromMs?: number };

function load(setup: string): Loaded[] {
  const out: Loaded[] = [];
  for (const fixture of readdirSync(SCENARIOS).sort()) {
    const rf = path.join(SCENARIOS, fixture, 'reference.json');
    const sf = path.join(SCENARIOS, fixture, `${setup}.result.json`);
    if (!existsSync(rf) || !existsSync(sf)) continue;
    const ref = JSON.parse(readFileSync(rf, 'utf8')) as { turns: Ref[] };
    const res = JSON.parse(readFileSync(sf, 'utf8')) as Result;
    // The lab scores a window from the start; reference speech beyond it is not part of the run.
    const reference = ref.turns.filter(([s]) => s < res.windowMs).map(([s, e, k]): Ref => [s, Math.min(e, res.windowMs), k]);
    out.push({ fixture, minutes: res.windowMs / 60_000, enrolled: res.enrolled ?? [], run: { reference, predicted: res.utterances.map((u) => gatePred(setup, u)) }, ...(res.enrolledFromMs !== undefined ? { enrolledFromMs: res.enrolledFromMs } : {}) });
  }
  return out;
}

const SETUPS = [
  { name: 'tracks', from: 'bleed', note: 'bleed results (a mic per person with cross-talk, the realistic tracks case)' },
  { name: 'call', from: 'mono-live', note: 'mono-live results: one mixed channel, voice only' },
  { name: 'room', from: 'mono-live', note: 'mono-live results: the same code path as call (channels {} and voice only)' },
  { name: 'recording', from: 'mono-recording', note: 'mono-recording results (diarized clusters named by the host)' },
] as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const gate: Record<string, { threshold: number; hostConfirmsAll: boolean; insufficient?: true }> = {};
const minutes = (ms: number) => (ms / 60_000).toFixed(1);
const cache = new Map<string, Loaded[]>();
const get = (s: string) => (cache.has(s) ? cache.get(s)! : (cache.set(s, load(s)), cache.get(s)!));

const lines: string[] = [];
const table = (title: string, loaded: Loaded[], c: Calibration) => {
  const fx = loaded.map((l) => `${l.fixture} (${l.minutes.toFixed(0)} min)`).join(', ');
  const t = pooled(loaded.map((l) => l.run), c.threshold);
  lines.push(`#### ${title}`, '', `Fixtures: ${fx}. Chosen threshold ${c.threshold}${c.hostConfirmsAll ? ', host confirms all (no candidate threshold reaches 2% wrong auto-accepts)' : ''}.`, '',
    '| Scope | Correct | Wrong, auto-accepted | Held | Held with a wrong guess | Missed |', '|---|---|---|---|---|---|',
    `| pooled | ${pct(t.correct)} | ${pct(t.wrongAuto)} | ${pct(t.held)} | ${pct(t.wrongHeld)} | ${pct(t.missed)} |`);
  for (const l of loaded) {
    const s = pooled([l.run], c.threshold);
    lines.push(`| ${l.fixture} | ${pct(s.correct)} | ${pct(s.wrongAuto)} | ${pct(s.held)} | ${pct(s.wrongHeld)} | ${pct(s.missed)} |`);
  }
  lines.push('');
};

/** Every mono-live run enrolled from audio after its scored window (P3-R6). */
function disjointEnrollment(): boolean {
  const runs = get('mono-live');
  return runs.length > 0 && runs.every((l) => l.enrolledFromMs !== undefined && l.enrolledFromMs >= l.minutes * 60_000);
}

const verdicts: string[] = [];
for (const s of SETUPS) {
  const loaded = get(s.from);
  if (!loaded.length) throw new Error(`no ${s.from} results in ${SCENARIOS}; run evals/attribution/run.ts first`);
  const c = calibrate(loaded.map((l) => l.run));
  gate[s.name] = { threshold: c.threshold, hostConfirmsAll: c.hostConfirmsAll, ...(c.insufficient ? { insufficient: true as const } : {}) };
  const sweep = [0.85, 0.88, 0.9, 0.92, 0.95, 0.97, 0.99].map((t) => [t, pooled(loaded.map((l) => l.run), t).wrongAuto] as const);
  const swept = sweep.map(([t, w]) => `${t}: ${pct(w)}`).join(', ');
  const flat = sweep.every(([, w]) => w === sweep[0]![1]);
  lines.push(`### ${s.name} (${s.note})`, '', `Wrong auto-accepted share by threshold, pooled: ${swept}.`, '');
  if (flat && !c.hostConfirmsAll) {
    const why = sweep[0]![1] > 0 ? 'the wrongly auto-accepted lines all score 0.99 or more, so raising the threshold does not remove them' : 'no line is wrongly auto-accepted at any threshold';
    lines.push(`The sweep is flat: ${why}. ${c.threshold} is the lowest candidate threshold, not a tuned value.`, '');
  }
  table(s.name, loaded, c);
  const n = `${c.sample.autoLines} auto-accepted lines, ${minutes(c.sample.autoSpeechMs)} minutes of auto-accepted speech`;
  const capped = s.name === 'call' || s.name === 'room';
  const disjointNote = s.from === 'mono-live' && disjointEnrollment() ? ' with enrollment disjoint from the scored window' : '';
  verdicts.push(c.hostConfirmsAll
    ? `- ${s.name}: does not pass. No threshold up to 0.99 keeps wrong auto-accepts at or under 2%; the host confirms every line.`
    : c.insufficient
      ? capped
        ? `- ${s.name}: keeps host confirmation (the voice-only cap stays) because the measured sample was too small: ${n}, ${pct(c.atThreshold.correct)} correct${disjointNote}. Wrong auto-accepts were ${pct(c.atThreshold.wrongAuto)} at ${c.threshold}, but a pass needs at least ${MIN_SAMPLE.lines} auto-accepted lines and ${MIN_SAMPLE.speechMs / 60_000} minutes. A longer measured run or real enrollment clips (recorded at a sound check, not cut from the program) would lift it.`
        : `- ${s.name}: wrong auto-accepts ${pct(c.atThreshold.wrongAuto)} at ${c.threshold} (correct ${pct(c.atThreshold.correct)}), but the sample is too small to count as passed: ${n}, against at least ${MIN_SAMPLE.lines} lines and ${MIN_SAMPLE.speechMs / 60_000} minutes. Marked insufficient in gate.json. ${s.name[0]!.toUpperCase()}${s.name.slice(1)} still auto-accepts at ${c.threshold} (ruling P3-R8): the minimum-sample rule governs only lifting the voice-only cap, and ${s.name} has no cap.`
      : `- ${s.name}: passes at threshold ${c.threshold} (wrong auto-accepts ${pct(c.atThreshold.wrongAuto)}, correct ${pct(c.atThreshold.correct)}; ${n}).`);
}

// tracks (silent between turns) reported as a reference beside bleed.
const tr = get('tracks');
if (tr.length) {
  const c = calibrate(tr.map((l) => l.run));
  lines.push('### tracks results, for reference only (isolated mics, silent between turns)', '');
  table('tracks (clean)', tr, c);
}

const monoLive = get('mono-live');
// The scenario cut's length: the recording runs cover the whole cut.
const recordingRuns = get('mono-recording');
if (!recordingRuns.length) throw new Error('no mono-recording results: the cut length comes from them');
const cutMinutes = Math.max(...recordingRuns.map((l) => l.minutes));
const disjoint = disjointEnrollment();
const date = new Date().toISOString().slice(0, 10);
const windows = (s: string) => get(s).map((l) => `${l.fixture} ${l.minutes.toFixed(0)} min`).join(', ');
const head = [
  '', `## Attribution gate, ${date}`, '',
  `Thresholds for auto-accepting who spoke, per setup. A threshold is the lowest of 0.85, 0.88, 0.90, 0.92, 0.95, 0.97, 0.99 at which wrong auto-accepts are at most 2% of reference speech time, pooled over the fixtures. If none is, the host confirms every line (0.99, host confirms all). A threshold that meets the 2% ceiling counts as passed only on a large enough sample: at least ${MIN_SAMPLE.lines} auto-accepted lines and ${MIN_SAMPLE.speechMs / 60_000} minutes of auto-accepted speech, pooled (ruling P3-R7); otherwise the setup is marked insufficient, and call and room keep the voice-only cap (the host confirms voice-only lines).`, '',
  '**Caveats.**',
  '- The reference is FluidAudio diarization plus Benjamin\'s confirmed speaker map, not a human gold set. Reference `UNK` is audience; a held or UNK prediction over it counts as correct, an auto-accepted debater over it counts as wrong.',
  disjoint
    ? `- Mono-live (call and room) enrollment clips come from reference speech in minutes ${monoLive[0]!.enrolledFromMs! / 60_000}–${cutMinutes.toFixed(0)} of the ${cutMinutes.toFixed(0)}-minute cut, disjoint from the scored window (minutes 0–${monoLive[0]!.minutes.toFixed(0)}), as a sound check records different audio from the session. Bleed enrollment clips still come from the scored audio, so its voice match is optimistic.`
    : '- Voice enrollment clips are taken from the scored audio, so voice match is optimistic (a real host enrolls before the session, on different audio).',
  `- The call/room sample is small: ${monoLive.length} windows of ${monoLive[0]!.minutes.toFixed(0)} minutes (${windows('mono-live')}).`,
  `- Enrolled in mono-live (a sound check keeps a clip only with at least 10 s of speech): ${monoLive.map((l) => `${l.fixture} ${l.enrolled.join(', ') || 'nobody'}`).join('; ')}. Lines of anyone not enrolled can only be held.`,
  '- Tracks fixtures are silent between turns; the bleed setup (each mic hears the others) is the realistic tracks case and is what the tracks threshold is calibrated on.',
  '- The lab\'s mono-live runs the room code path, which is also the call code path (channels `{}`, voice only), so call and room share these results.',
  '- Mono-live lines are scored as the gate would see them with the voice-only cap (0.84) lifted: predicted = candidate, else the attributed key; confidence = uncapped fused score. Only the cap is lifted: a line counts toward auto-accept only when the cap was its sole reason for being held. Lines held for any other reason (no candidate, a fused score below the cap) stay held at every threshold, as do lines that are pending in other setups.',
  `- Window lengths: mono-live ${windows('mono-live')} (first minutes of the program only); bleed ${windows('bleed')}; mono-recording ${windows('mono-recording')}.`,
  '- Shares are of reference speech time inside the window, at 10 ms resolution. Held is all held speech; "held with a wrong guess" is the part of it whose candidate was wrong or missing.', '',
  '**Verdicts (2% wrong auto-accept ceiling).**', ...verdicts, '',
];
// One "Attribution gate" section: replace the previous one (up to the next top-level heading) rather than append another.
const resultsPath = path.join(ROOT, 'evals/results.md');
const results = readFileSync(resultsPath, 'utf8');
const section = [...head, ...lines].join('\n');
const at = results.search(/\n## Attribution gate\b/);
const next = at < 0 ? -1 : results.slice(at + 1).search(/\n## /);
writeFileSync(resultsPath, at < 0 ? results + section : results.slice(0, at) + section + (next < 0 ? '' : results.slice(at + 1 + next)));
writeFileSync(path.join(ROOT, 'apps/web/lib/attribution/gate.json'), `${JSON.stringify(gate, null, 2)}\n`);
console.log(JSON.stringify(gate, null, 2));
console.log(verdicts.join('\n'));
