'use client';

// The attribution lab (dev only). Feeds a scenario's audio through the shipping code paths as fast
// as they run, without real time: live setups go frame by frame through the Segmenter into the
// LiveRunner (stub ASR, the real voice match); the recording goes through whole-file separation,
// groupVoices, the simulated host naming, and buildUtterances. evals/attribution/run.ts calls
// window.__adlLab.run and writes what it returns.
import { useEffect } from 'react';
import { enrollmentError, trimAnchor, type Anchor } from '@/lib/attribution/anchors';
import { fuse } from '@/lib/attribution/fusion';
import { capVoiceOnly, VOICE_ONLY_CAP } from '@/lib/attribution/gate';
import { DiarizeClient } from '@/lib/diarize/client';
import { listenChannels } from '@/lib/live/live-view';
import { MemoryEventLog } from '@/lib/live/memory-log';
import { LiveRunner, type LiveSetup } from '@/lib/live/runner';
import { Segmenter } from '@/lib/live/segmenter';
import { buildUtterances } from '@/lib/recording/utterances';
import { groupVoices } from '@/lib/recording/voices';
import { anchorClip, linesFromEvents, nameVoices, parseWav, speechWords, type LabLine, type Reference } from './scenario';

export type LabSetup = 'tracks' | 'bleed' | 'mono-live' | 'mono-recording';
export type LabResult = {
  utterances: LabLine[];
  /** Wall time of the run. */
  seconds: number;
  /** Scenario time the run covered, from 0 (P3-R2: mono-live runs on the first 5 minutes). */
  windowMs: number;
  /** Participants with an enrollment anchor (a sound check keeps only clips with 10 s of speech). */
  enrolled: string[];
  /** Recording only: each separated voice and who the simulated host named it (null: someone else). */
  voiceMap?: Record<string, string | null>;
  /** Live only: runner failures and notices by kind. */
  failed?: number;
  notices?: Record<string, number>;
};

declare global {
  interface Window {
    __adlLab?: { run(o: { fixture: string; setup: LabSetup }): Promise<LabResult> };
  }
}

const RATE = 16_000;
const FRAME = RATE / 50;
const LIVE_WINDOW_MS = 5 * 60_000;
const SESSION = 'lab';

const file = (fixture: string, name: string) => fetch(`/api/dev/scenario/${encodeURIComponent(fixture)}/${name}`).then((r) => {
  if (!r.ok) throw new Error(`${fixture}/${name}: ${r.status}`);
  return r;
});
const wav = async (fixture: string, name: string) => parseWav(await (await file(fixture, name)).arrayBuffer());

let diarizer: Promise<DiarizeClient> | null = null;
const voices = () => (diarizer ??= DiarizeClient.load());

/** One anchor per participant, from their first 30 s of reference speech on `source`, as a sound check would keep it. */
function enroll(ref: Reference, source: (key: string) => Float32Array): Anchor[] {
  return ref.participants.flatMap((p) => {
    const clip = anchorClip(source(p.key), ref.turns, p.key);
    return enrollmentError(p.displayName, clip) ? [] : [{ key: p.key, pcm: trimAnchor(clip) }];
  });
}

async function runLive(fixture: string, setup: 'tracks' | 'bleed' | 'mono-live', ref: Reference): Promise<Omit<LabResult, 'seconds'>> {
  const keys = ref.participants.map((p) => p.key);
  const byKey = new Map<string, Float32Array>();
  if (setup === 'mono-live') byKey.set('*', await wav(fixture, 'mono.wav'));
  else for (const k of keys) byKey.set(k, await wav(fixture, `${setup}/${k}.wav`));
  const anchors = enroll(ref, (k) => byKey.get(setup === 'mono-live' ? '*' : k)!);

  const live: LiveSetup = setup === 'mono-live'
    ? { kind: 'room', channels: {}, participants: ref.participants.map(({ key, displayName }) => ({ key, displayName })) }
    : { kind: 'tracks', channels: Object.fromEntries(keys.map((k, i) => [`d${i}c0`, k])), participants: ref.participants.map(({ key, displayName }) => ({ key, displayName })) };
  const channels = listenChannels(live);
  const audio = new Map(channels.map((c) => [c, setup === 'mono-live' ? byKey.get('*')! : byKey.get(live.channels[c]!)!]));
  const total = Math.min(...[...audio.values()].map((a) => a.length));
  const windowMs = Math.floor((setup === 'mono-live' ? Math.min(total, (LIVE_WINDOW_MS * RATE) / 1000) : total) / FRAME) * 20;

  const log = new MemoryEventLog();
  let status: { failed: number; notices: Record<string, number> } = { failed: 0, notices: {} };
  const runner = new LiveRunner({
    sessionId: SESSION,
    setup: live,
    anchors,
    asr: { transcribe: async (pcm, startMs) => [{ text: 'x', startMs, endMs: startMs + Math.round((pcm.length * 1000) / RATE) }] },
    voices: await voices(),
    log,
    onStatus: (s) => {
      const notices: Record<string, number> = {};
      for (const n of s.notices) notices[n.kind] = (notices[n.kind] ?? 0) + 1;
      status = { failed: s.failed.length, notices };
    },
  });
  const done: Promise<void>[] = [];
  const seg = new Segmenter({ channels, offsetMs: 0, wallStartMs: 0, onUtterance: (x) => done.push(runner.onUtterance(x.channel, x.u, x.rms, x.overlap, x.endedAtWallMs)) });
  const frames = windowMs / 20;
  for (let i = 0; i < frames; i++) {
    for (const c of channels) seg.push(c, audio.get(c)!.subarray(i * FRAME, (i + 1) * FRAME), i * 20);
    // The once-a-second activity tick listen() gives the runner, on media time.
    if ((i + 1) % 50 === 0) {
      const now = (i + 1) * 20;
      runner.tick(now, seg.active(now));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  runner.tick(windowMs + 10_000, seg.active(windowMs + 10_000));
  await Promise.all(done);
  await runner.stop();
  // A capped line (room: voice only) scored at least the cap; its uncapped score is its best voice match, fused alone.
  const capped = capVoiceOnly(live.kind, 1) < 1;
  const uncap = (confidence: number, voiceprint: Record<string, number> | undefined) =>
    capped && confidence === VOICE_ONLY_CAP && voiceprint ? fuse({ channelMarginDb: null, voiceMatch: Math.max(...Object.values(voiceprint)), diarizerAgrees: null, overlap: false }) : undefined;
  return { utterances: linesFromEvents(log.events, uncap), windowMs, enrolled: anchors.map((a) => a.key), ...status };
}

async function runRecording(fixture: string, ref: Reference): Promise<Omit<LabResult, 'seconds'>> {
  const mono = await wav(fixture, 'mono.wav');
  const segments = await (await voices()).diarize(mono);
  const { voices: listed } = groupVoices(segments);
  // Short voices are never offered for naming: absent from the map, they stay unattributed.
  const voiceMap = nameVoices(listed, ref.turns, ref.participants.map((p) => p.key));
  const events = buildUtterances({ sessionId: SESSION, words: speechWords(mono), segments, voiceMap, mode: 'diarized', wallTs: new Date(0).toISOString() });
  return { utterances: linesFromEvents(events), windowMs: Math.floor((mono.length * 1000) / RATE), enrolled: [], voiceMap };
}

async function run({ fixture, setup }: { fixture: string; setup: LabSetup }): Promise<LabResult> {
  const t0 = performance.now();
  const ref = (await (await file(fixture, 'reference.json')).json()) as Reference;
  const r = setup === 'mono-recording' ? await runRecording(fixture, ref) : await runLive(fixture, setup, ref);
  return { ...r, seconds: Math.round((performance.now() - t0) / 100) / 10 };
}

export function Lab() {
  useEffect(() => {
    window.__adlLab = { run };
    return () => { delete window.__adlLab; };
  }, []);
  return (
    <main className="min-h-dvh bg-field px-6 py-12">
      <h1 className="text-[30px] leading-tight text-ink">Attribution lab</h1>
      <p className="mt-3 text-[15px] text-ink-2">Run evals/attribution/run.ts to measure the scenarios.</p>
    </main>
  );
}
