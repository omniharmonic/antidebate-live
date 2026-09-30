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
import { fuse } from '../../apps/web/lib/attribution/fusion';
import { calibrate, duplicates, gateEntry, gatePred, MIN_SAMPLE, pooled, worstGate, type Calibration, type GateEntry, type LabPred, type Ref, type Run } from './score';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIOS = path.join(ROOT, '.data/scenarios');

type Result = { utterances: LabPred[]; windowMs: number; enrolled?: string[]; enrolledFromMs?: number; enrollSpans?: Ref[] };
type Loaded = { fixture: string; run: Run; lines: LabPred[]; minutes: number; enrolled: string[]; enrolledFromMs?: number; enrollSpans?: Ref[] };

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
    // Tracks setups enroll from each person's last 30 s of speech; those spans are not scored (P3-R11).
    const exclude = res.enrollSpans?.map(([s, e]): [number, number] => [s, e]);
    out.push({
      fixture, minutes: res.windowMs / 60_000, enrolled: res.enrolled ?? [], lines: res.utterances,
      run: { reference, predicted: res.utterances.map((u) => gatePred(setup, u)), ...(exclude ? { exclude } : {}) },
      ...(res.enrolledFromMs !== undefined ? { enrolledFromMs: res.enrolledFromMs } : {}),
      ...(res.enrollSpans ? { enrollSpans: res.enrollSpans } : {}),
    });
  }
  return out;
}

/** Mic-per-person scenarios. The realistic ones (P3-R11) set the tracks gate; -15 dB is kept beside them. */
const TRACKS = [
  { from: 'bleed-6', label: 'mics hear each other at -6 dB', realistic: true },
  { from: 'bleed-9', label: 'mics hear each other at -9 dB', realistic: true },
  { from: 'unmiked', label: 'no moderator mic: the moderator at -3 dB on both debater mics, debaters at -9 dB on each other\'s', realistic: true },
  { from: 'bleed', label: 'mics hear each other at -15 dB (well separated)', realistic: false },
] as const;
const SETUPS = [
  { name: 'call', from: 'mono-live', note: 'mono-live results: one mixed channel, voice only; a room mix standing in for call audio' },
  { name: 'room', from: 'mono-live', note: 'mono-live results: the same code path as call (channels {} and voice only)' },
  { name: 'recording', from: 'mono-recording', note: 'mono-recording results (diarized clusters named by the host)' },
] as const;
const THRESHOLDS = [0.85, 0.88, 0.9, 0.92, 0.95, 0.97, 0.99];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const gate: Record<string, GateEntry> = {};
const minutes = (ms: number) => (ms / 60_000).toFixed(1);
const cache = new Map<string, Loaded[]>();
const get = (s: string) => (cache.has(s) ? cache.get(s)! : (cache.set(s, load(s)), cache.get(s)!));
const need = (s: string) => {
  const l = get(s);
  if (!l.length) throw new Error(`no ${s} results in ${SCENARIOS}; run evals/attribution/run.ts first`);
  return l;
};

const lines: string[] = [];
const HEADER = ['| Scope | Correct | Wrong, auto-accepted (share of speech) | Wrong, share of auto-accepted speech | Held | Held, guess wrong or missing | Missed |', '|---|---|---|---|---|---|---|'];
const row = (scope: string, t: ReturnType<typeof pooled>) => `| ${scope} | ${pct(t.correct)} | ${pct(t.wrongAuto)} | ${pct(t.wrongAutoOfAuto)} | ${pct(t.held)} | ${pct(t.wrongHeld)} | ${pct(t.missed)} |`;
const table = (title: string, loaded: Loaded[], c: Calibration) => {
  const fx = loaded.map((l) => `${l.fixture} (${l.minutes.toFixed(0)} min)`).join(', ');
  lines.push(`#### ${title}`, '', `Fixtures: ${fx}. Chosen threshold ${c.threshold}${c.hostConfirmsAll ? ', host confirms all (no candidate threshold keeps wrong auto-accepts at or under 2%, pooled and in every fixture)' : ''}.`, '', ...HEADER, row('pooled', pooled(loaded.map((l) => l.run), c.threshold)));
  for (const l of loaded) lines.push(row(l.fixture, pooled([l.run], c.threshold)));
  lines.push('');
};
const sweepLines = (loaded: Loaded[], c: Calibration) => {
  const sweep = THRESHOLDS.map((t) => [t, pooled(loaded.map((l) => l.run), t).wrongAuto] as const);
  lines.push(`Wrong auto-accepted share by threshold, pooled: ${sweep.map(([t, w]) => `${t}: ${pct(w)}`).join(', ')}.`, '');
  if (sweep.every(([, w]) => w === sweep[0]![1]) && !c.hostConfirmsAll) {
    const why = sweep[0]![1] > 0 ? 'the wrongly auto-accepted lines all score 0.99 or more, so raising the threshold does not remove them' : 'no line is wrongly auto-accepted at any threshold';
    lines.push(`The sweep is flat: ${why}. ${c.threshold} is the lowest candidate threshold, not a tuned value.`, '');
  }
};
const sampleText = (c: Calibration) => `${c.sample.autoLines} auto-accepted line${c.sample.autoLines === 1 ? '' : 's'}, ${minutes(c.sample.autoSpeechMs)} minutes of auto-accepted speech, ${c.sample.fixturesAtMin} fixture${c.sample.fixturesAtMin === 1 ? '' : 's'} with at least ${MIN_SAMPLE.fixtureLines} of them`;
const rule = `at least ${MIN_SAMPLE.lines} auto-accepted lines, ${MIN_SAMPLE.speechMs / 60_000} minutes of them, and at least ${MIN_SAMPLE.fixtures} fixtures with ${MIN_SAMPLE.fixtureLines} or more each`;

/** Every mono-live run enrolled from audio after its scored window (P3-R6). */
function disjointEnrollment(): boolean {
  const runs = get('mono-live');
  return runs.length > 0 && runs.every((l) => l.enrolledFromMs !== undefined && l.enrolledFromMs >= l.minutes * 60_000);
}

const verdicts: string[] = [];

// Tracks: every mic-per-person scenario, the gate is the worst of them (P3-R11).
type Scenario = { from: string; label: string; realistic: boolean; loaded: Loaded[]; c: Calibration; entry: GateEntry; dup: number; total: number };
const scenarios: Scenario[] = TRACKS.map((t) => {
  const loaded = need(t.from);
  const c = calibrate(loaded.map((l) => l.run));
  const dup = loaded.reduce((n, l) => n + duplicates(l.lines, l.run.exclude), 0);
  const total = loaded.reduce((n, l) => n + l.lines.length, 0);
  return { ...t, loaded, c, entry: gateEntry('tracks', c, { disjointEnrollment: true }), dup, total };
});
gate.tracks = worstGate(scenarios.map((s) => s.entry));
const worst = scenarios.find((s) => s.entry.hostConfirmsAll === gate.tracks!.hostConfirmsAll && s.entry.threshold === gate.tracks!.threshold && (s.entry.insufficient ?? false) === (gate.tracks!.insufficient ?? false)) ?? scenarios[0]!;
const tracksText = (s: Scenario) => s.c.hostConfirmsAll
  ? `no threshold up to 0.99 keeps wrong auto-accepts at or under 2% (pooled and in every fixture), so the host confirms every line`
  : `wrong auto-accepts ${pct(s.c.atThreshold.wrongAuto)} of speech (${pct(s.c.atThreshold.wrongAutoOfAuto)} of auto-accepted speech) at ${s.c.threshold}, correct ${pct(s.c.atThreshold.correct)}, held ${pct(s.c.atThreshold.held)}; ${sampleText(s.c)}${s.c.insufficient ? ` (insufficient: a pass needs ${rule})` : ''}`;
verdicts.push(`- tracks: set by the strictest mic-per-person scenario, ${worst.from} (${worst.label}): ${tracksText(worst)}. gate.json: threshold ${gate.tracks.threshold}${gate.tracks.hostConfirmsAll ? ', host confirms all' : ''}${gate.tracks.insufficient ? ', insufficient' : ''}. Tracks has no voice-only cap to lift except for a dead mic, which is always capped; the minimum-sample rule does not change how tracks lines are decided.`);

// The mic-per-person scenarios, the realistic ones first.
const unmiked = scenarios.find((s) => s.from === 'unmiked')!;
const unmikedHeld = unmiked.c.atThreshold.held;
const mikedHeld = scenarios.filter((x) => x.realistic && x.from !== 'unmiked').map((x) => x.c.atThreshold.held);
lines.push('### tracks (a mic per person)', '',
  `The tracks gate is the strictest of these scenarios (ruling P3-R11). Each line is decided by the shipping code; a dead mic's voice-only lines are always capped, so they are held. A duplicate is the same speech logged as two lines: two lines on different mics overlapping by more than half of the shorter one.`, '',
  '| Scenario | Correct | Wrong, auto-accepted (share of speech) | Wrong, share of auto-accepted speech | Held | Duplicate lines | Threshold |', '|---|---|---|---|---|---|---|',
  ...scenarios.map((s) => `| ${s.from}${s.realistic ? '' : ' (reference)'}: ${s.label} | ${pct(s.c.atThreshold.correct)} | ${pct(s.c.atThreshold.wrongAuto)} | ${pct(s.c.atThreshold.wrongAutoOfAuto)} | ${pct(s.c.atThreshold.held)} | ${s.dup} of ${s.total} | ${s.c.threshold}${s.c.hostConfirmsAll ? ', host confirms all' : ''}${s.c.insufficient ? ', insufficient' : ''} |`), '',
  `Why so much is held at close bleed: a mic-per-person line auto-accepts on its margin over the loudest other mic, its voice match and their agreement (fusion.ts). With a perfect voice match that agrees, a 6 dB margin fuses to at most ${fuse({ channelMarginDb: 6, voiceMatch: 1, diarizerAgrees: true, overlap: false })} and a 9 dB margin to ${fuse({ channelMarginDb: 9, voiceMatch: 1, diarizerAgrees: true, overlap: false })}, against the 0.85 threshold, so at -6 dB every line is held by construction and at -9 dB a line passes only when the voice match is strong. At 12 dB or more the margin alone decides, and voice matching is skipped when everyone is miked and enrolled, which is why -15 dB auto-accepts most lines.`, '',
  unmikedHeld > 0.3
    ? `**Without a moderator mic, ${pct(unmikedHeld)} of speech is held for the host to confirm, above 30%.** The moderator is heard on both debater mics at nearly the same level, so no margin decides those lines. Recommendation: give the moderator a mic (docs/HOSTING.md, docs/R0_DEMO.md).${mikedHeld.every((h) => h > 0.3) ? ` A moderator mic alone does not bring the held share under 30% here: with everyone miked, ${scenarios.filter((x) => x.realistic && x.from !== 'unmiked').map((x) => `${x.from} holds ${pct(x.c.atThreshold.held)}`).join(' and ')}. Separation between the mics does: at -15 dB, ${pct(scenarios.find((x) => x.from === 'bleed')!.c.atThreshold.held)} is held. Place each mic close to its speaker, so each voice is at least 12 dB louder on its own mic than on the others.` : ''}`
    : `Without a moderator mic, ${pct(unmikedHeld)} of speech is held for the host to confirm (at or under 30%).`, '');
for (const s of scenarios) {
  table(s.from, s.loaded, s.c);
  sweepLines(s.loaded, s.c);
}

for (const s of SETUPS) {
  const loaded = need(s.from);
  const c = calibrate(loaded.map((l) => l.run));
  const entry = gateEntry(s.name, c, { disjointEnrollment: disjointEnrollment() });
  gate[s.name] = entry;
  lines.push(`### ${s.name} (${s.note})`, '');
  sweepLines(loaded, c);
  table(s.name, loaded, c);
  const n = sampleText(c);
  const disjointNote = s.from === 'mono-live' && disjointEnrollment() ? ' with enrollment disjoint from the scored window' : '';
  const measured = `wrong auto-accepts ${pct(c.atThreshold.wrongAuto)} of speech (${pct(c.atThreshold.wrongAutoOfAuto)} of auto-accepted speech) at ${c.threshold}, correct ${pct(c.atThreshold.correct)}${disjointNote}; ${n}`;
  if (c.hostConfirmsAll) verdicts.push(`- ${s.name}: does not pass. No threshold up to 0.99 keeps wrong auto-accepts at or under 2% (pooled and in every fixture); the host confirms every line.`);
  else if (s.name === 'call') verdicts.push(`- call: keeps host confirmation (the voice-only cap stays). It is measured from the room mix, not call audio, so it stays insufficient until call-like audio is measured (ruling P3-R10). On the room mix: ${measured}.`);
  else if (s.name === 'room' && entry.insufficient) verdicts.push(`- room: keeps host confirmation (the voice-only cap stays) because the evidence is too thin: ${measured}. A pass needs ${rule}${disjointEnrollment() ? '' : ', on enrollment disjoint from the scored audio (P3-R6)'}. A longer measured run or real enrollment clips (recorded at a sound check, not cut from the program) could lift it.`);
  else if (entry.insufficient) verdicts.push(`- ${s.name}: ${measured}. Too small or unrepresentative a sample to count as passed (a pass needs ${rule}); marked insufficient in gate.json. ${s.name[0]!.toUpperCase()}${s.name.slice(1)} still auto-accepts at ${c.threshold} (ruling P3-R8): the minimum-sample rule governs only lifting the voice-only cap, and ${s.name} has no cap.`);
  else verdicts.push(`- ${s.name}: passes at threshold ${c.threshold} (${measured}).`);
}

// tracks (silent between turns) reported as a reference beside the bleed scenarios.
const tr = get('tracks');
if (tr.length) {
  const c = calibrate(tr.map((l) => l.run));
  const dead = tr.reduce((n, l) => n + l.lines.filter((u) => u.capped).length, 0);
  lines.push('### tracks results, for reference only (isolated mics, silent between turns)', '',
    `Isolated tracks are digitally silent between turns, so a mic goes quiet for a minute while others speak and the app treats it as dead; its lines are then decided by voice alone, which is always capped and held (ruling P3-R10). The cap lowered the score of ${dead} lines here. Real mics hear the room, so this is not the realistic case (none of the bleed scenarios raised a dead-mic notice).`, '');
  table('tracks (clean)', tr, c);
}

const monoLive = need('mono-live');
// The scenario cut's length: the recording runs cover the whole cut.
const cutMinutes = Math.max(...need('mono-recording').map((l) => l.minutes));
const disjoint = disjointEnrollment();
const date = new Date().toISOString().slice(0, 10);
const windows = (s: string) => get(s).map((l) => `${l.fixture} ${l.minutes.toFixed(0)} min`).join(', ');
const enrolledIn = (s: string) => get(s).map((l) => `${l.fixture} ${l.enrolled.join(', ') || 'nobody'}`).join('; ');
const head = [
  '', `## Attribution gate, ${date}`, '',
  `Thresholds for auto-accepting who spoke, per setup. A threshold is the lowest of ${THRESHOLDS.map((t) => t.toFixed(2)).join(', ')} at which wrong auto-accepts are at most 2% of reference speech time, pooled over the fixtures and in every fixture that auto-accepts anything (ruling P3-R10). If none is, the host confirms every line (0.99, host confirms all). A threshold that meets the ceiling counts as passed only on enough representative evidence: ${rule} (rulings P3-R7, P3-R10); otherwise the setup is marked insufficient, and call and room keep the voice-only cap (the host confirms voice-only lines). Wrong auto-accepts are also given as a share of auto-accepted speech (the precision view).`, '',
  '**Caveats.**',
  '- The reference is FluidAudio diarization plus Benjamin\'s confirmed speaker map, not a human gold set. Reference `UNK` is audience; a held or UNK prediction over it counts as correct, an auto-accepted debater over it counts as wrong.',
  disjoint
    ? `- Mono-live (call and room) enrollment clips come from reference speech in minutes ${monoLive[0]!.enrolledFromMs! / 60_000}–${cutMinutes.toFixed(0)} of the ${cutMinutes.toFixed(0)}-minute cut, disjoint from the scored window (minutes 0–${monoLive[0]!.minutes.toFixed(0)}), as a sound check records different audio from the session.`
    : '- Mono-live voice enrollment clips are taken from the scored audio, so voice match is optimistic (a real host enrolls before the session, on different audio).',
  '- Mic-per-person scenarios enroll each person from their last 30 s of reference speech on their own mic (a moderator without a mic: on the first debater\'s mic, the nearest one), and those 30 s are left out of scoring, so no enrollment clip is scored audio. A person with under 10 s of speech in their clip is not enrolled, as a sound check would reject the clip.',
  `- Enrolled: mono-live: ${enrolledIn('mono-live')}. ${TRACKS.map((t) => `${t.from}: ${enrolledIn(t.from)}`).join('. ')}. Lines of anyone not enrolled cannot be matched by voice.`,
  `- The call/room sample is small: ${monoLive.length} windows of ${monoLive[0]!.minutes.toFixed(0)} minutes (${windows('mono-live')}).`,
  '- Call is not measured on call audio: the lab\'s mono-live runs the room code path on a room mix (channels `{}`, voice only), so call and room share these results, and call is marked `measuredFrom: room-mix` and insufficient in gate.json (ruling P3-R10).',
  '- Mono-live lines are scored as the gate would see them with the voice-only cap (0.84) lifted: predicted = candidate, else the attributed key; confidence = uncapped fused score. Only the cap is lifted, and only on lines the lab flags capped (from the attributor\'s own decision). Lines held for any other reason stay held at every threshold, as do lines that are pending in other setups.',
  '- A held line is scored on its best guess (its top candidate): "held, guess wrong or missing" is the held speech whose guess was wrong or which had no guess.',
  `- Window lengths: mono-live ${windows('mono-live')} (first minutes of the program only); mic-per-person ${windows('unmiked')}; mono-recording ${windows('mono-recording')}.`,
  '- Shares are of reference speech time inside the window, at 10 ms resolution, except the precision view (share of auto-accepted speech).', '',
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
