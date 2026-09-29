import type { DomainEvent } from '@adl/core';
import type { EventLog } from '@adl/engine';
import type { AsrClient } from '../asr/client';
import type { Anchor } from '../attribution/anchors';
import { trimAnchor } from '../attribution/anchors';
import { Attributor, type ChannelMap, type Notice, type Setup } from '../attribution/attributor';

export type LiveSetup = { kind: Setup; channels: ChannelMap; participants: { key: string; displayName: string }[] };
export type LiveStatus = {
  audio: 'ok' | 'stopped';
  queue: number;
  lastLatencyMs: number | null;
  notices: Notice[];
  unconfirmed: { utteranceId: string; text: string; candidates: Record<string, number> }[];
  /** Voices nobody enrolled, in the order they were heard, with the utterances to confirm together. */
  newVoices: { label: string; utteranceIds: string[] }[];
  /** Utterances that could not be transcribed or written. `retryAt(channel, startMs)` runs one again. */
  failed: { channel: string; startMs: number; endMs: number; reason: string }[];
};

type Job = { channel: string; u: { startMs: number; endMs: number; pcm: Float32Array }; rms: Record<string, number>; overlap: boolean; arrivedAt: number; endedAt?: number };

/** Temporary voices are only for grouping; a match this good joins one. */
const TEMP_VOICE_MATCH = 0.5;
const MAX_TEMP_VOICES = 4;
const TEMP_ANCHOR_MS = 8_000;

/** A channel this far above every other one is unambiguous (either way), so the voice match is skipped. */
const CLEAR_MARGIN_DB = 12;

export type LiveRunnerOptions = {
  sessionId: string;
  setup: LiveSetup;
  anchors: Anchor[];
  asr: Pick<AsrClient, 'transcribe'>;
  voices: { matchVoices(a: Anchor[], u: Float32Array): Promise<Record<string, number>> };
  log: EventLog;
  onStatus(s: LiveStatus): void;
  /** Epoch ms. Injected so the clock is only read here. */
  now?: () => number;
};

export class LiveRunner {
  private readonly attributor: Attributor;
  private readonly now: () => number;
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private stopped = false;
  private lastLatencyMs: number | null = null;
  private notices: Notice[] = [];
  private readonly unconfirmed = new Map<string, { text: string; candidates: Record<string, number>; endMs: number }>();
  private readonly newVoices: { label: string; utteranceIds: string[] }[] = [];
  private lastMediaMs = 0;
  private confirmSeq = 0;
  private readonly failed: { job: Job; reason: string }[] = [];
  private readonly temp: { label: string; pcm: Float32Array }[] = [];
  private matchFailing = false;
  /** Labels are never reused, even after their utterances are confirmed away. */
  private voiceCount = 0;

  constructor(private readonly o: LiveRunnerOptions) {
    this.attributor = new Attributor(o.setup.kind, o.setup.channels);
    this.now = o.now ?? Date.now;
  }

  /**
   * Queues the utterance; ASR, matching and emission run one utterance at a time. Never rejects:
   * a failure lands in status.failed with the audio kept for `retry`. `endedAtWallMs` is when the
   * speech ended on the wall clock (the caller knows the tap start); without it latency counts from arrival.
   */
  onUtterance(channel: string, u: { startMs: number; endMs: number; pcm: Float32Array }, rms: Record<string, number>, overlap: boolean, endedAtWallMs?: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.enqueue({ channel, u, rms, overlap, arrivedAt: this.now(), ...(endedAtWallMs !== undefined ? { endedAt: endedAtWallMs } : {}) });
  }

  /** Runs a failed utterance again (index into status.failed). */
  retry(index: number): Promise<void> {
    const item = index >= 0 ? this.failed[index] : undefined;
    if (!item) return Promise.resolve();
    this.failed.splice(index, 1);
    return this.enqueue({ ...item.job, arrivedAt: this.now() });
  }

  /** Runs a failed utterance again by its channel and start: stable while other items come and go. */
  retryAt(channel: string, startMs: number): Promise<void> {
    return this.retry(this.failed.findIndex((f) => f.job.channel === channel && f.job.u.startMs === startMs));
  }

  private enqueue(job: Job): Promise<void> {
    this.queued += 1;
    this.publish();
    const run = this.chain.then(async () => {
      try {
        await this.process(job);
      } catch (e) {
        this.failed.push({ job, reason: e instanceof Error ? e.message : String(e) });
      }
    });
    this.chain = run.then(() => {
      this.queued -= 1;
      this.publish();
    });
    return run;
  }

  async confirm(utteranceId: string, participantKey: string): Promise<void> {
    const held = this.unconfirmed.get(utteranceId);
    await this.o.log.append([
      {
        eventId: `${this.o.sessionId}:${utteranceId}:confirmed:${this.now()}-${++this.confirmSeq}`,
        sessionId: this.o.sessionId,
        type: 'attribution.confirmed',
        actor: 'operator',
        mediaMs: held?.endMs ?? this.lastMediaMs,
        wallTs: this.wallTs(),
        payload: { utteranceId, participantKey },
      } as DomainEvent,
    ]);
    this.unconfirmed.delete(utteranceId);
    for (const v of this.newVoices) v.utteranceIds = v.utteranceIds.filter((id) => id !== utteranceId);
    for (let i = this.newVoices.length - 1; i >= 0; i--) if (this.newVoices[i]!.utteranceIds.length === 0) this.newVoices.splice(i, 1);
    this.publish();
  }

  /** The host accepted a swap suggestion. */
  applySwap(a: string, b: string): void {
    this.attributor.applySwap(a, b);
  }

  tick(nowMs: number, active: Record<string, boolean>): void {
    const fresh = this.attributor.tick(nowMs, active);
    if (fresh.length === 0) return;
    this.notices = [...this.notices, ...fresh];
    this.publish();
  }

  /** Waits for queued utterances to finish. Appends nothing: ending the session is the engine's finishSource(). */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.chain;
    this.publish();
  }

  private async process(job: Job): Promise<void> {
    const { channel, u, rms, overlap } = job;
    const { setup, sessionId, log } = this.o;
    const words = await this.o.asr.transcribe(u.pcm, u.startMs);
    if (words.length === 0) return;

    let scores: Record<string, number> = {};
    let matchFailed = false;
    if (!this.isUnambiguous(channel, rms)) {
      try {
        scores = await this.o.voices.matchVoices([...this.o.anchors, ...this.temp.map((t) => ({ key: t.label, pcm: t.pcm }))], u.pcm);
        this.matchFailing = false;
      } catch {
        // The transcript is still good: it goes to the log as pending, and the host is told once per streak.
        matchFailed = true;
        if (!this.matchFailing) this.notices.push({ kind: 'voice_match_unavailable' });
        this.matchFailing = true;
      }
    }
    const tempLabels = new Set(this.temp.map((t) => t.label));
    const voice: Record<string, number> = {};
    let tempBest: [string, number] | null = null;
    for (const [k, v] of Object.entries(scores)) {
      if (!tempLabels.has(k)) voice[k] = v;
      else if (!tempBest || v > tempBest[1]) tempBest = [k, v];
    }
    const { decision, notices } = this.attributor.decide({
      channel: setup.kind === 'room' ? null : channel,
      channelRmsDb: rms,
      voice,
      overlap,
      startMs: u.startMs,
      endMs: u.endMs,
    });
    if (decision.drop) return;

    const id = `u${channel}-${u.startMs}`;
    const text = words.map((w) => w.text).join(' ').replace(/\s+([.,!?;:])/g, '$1');
    const wallTs = this.wallTs();
    const events: DomainEvent[] = [];
    let candidates: Record<string, number> = {};
    if (decision.pending) {
      candidates = decision.candidate !== undefined ? { [decision.candidate]: decision.confidence } : {};
      events.push({ eventId: `${sessionId}:${id}:pending`, sessionId, type: 'attribution.pending', actor: 'system', mediaMs: u.endMs, wallTs, payload: { utteranceId: id, candidates } } as DomainEvent);
    }
    events.push({
      eventId: `${sessionId}:${id}`,
      sessionId,
      type: 'utterance.final',
      actor: 'system',
      mediaMs: u.endMs,
      wallTs,
      payload: {
        utterance: {
          id,
          participantKey: decision.participantKey,
          startMs: u.startMs,
          endMs: u.endMs,
          text,
          words: words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs, ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) })),
          attribution: { confidence: decision.confidence, signals: decision.signals, confirmedBy: 'auto' as const },
          overlapsWith: [],
        },
      },
    } as DomainEvent);
    await log.append(events);

    this.lastMediaMs = u.endMs;
    if (decision.pending) this.unconfirmed.set(id, { text, candidates, endMs: u.endMs });
    for (const n of notices) {
      if (n.kind !== 'new_voice') this.notices.push(n);
      else if (!matchFailed) this.groupNewVoice(id, u.pcm, tempBest);
    }
    this.lastLatencyMs = this.now() - (job.endedAt ?? job.arrivedAt);
    this.publish();
  }

  /** Joins the utterance to the temporary voice it matches, or starts the next one (up to the cap). */
  private groupNewVoice(id: string, pcm: Float32Array, tempBest: [string, number] | null): void {
    if (tempBest && tempBest[1] >= TEMP_VOICE_MATCH) {
      const group = this.newVoices.find((v) => v.label === tempBest[0]);
      // A group emptied by confirming its lines is recreated when the same voice speaks again.
      if (group) group.utteranceIds.push(id);
      else this.newVoices.push({ label: tempBest[0], utteranceIds: [id] });
      return;
    }
    if (this.temp.length >= MAX_TEMP_VOICES) return;
    const label = `Voice ${++this.voiceCount}`;
    const trimmed = trimAnchor(pcm, TEMP_ANCHOR_MS);
    this.temp.push({ label, pcm: trimmed.length > 0 ? trimmed : pcm.slice(0, (16_000 * TEMP_ANCHOR_MS) / 1000) });
    this.newVoices.push({ label, utteranceIds: [id] });
  }

  private isUnambiguous(channel: string, rms: Record<string, number>): boolean {
    if (this.o.setup.kind !== 'tracks') return false;
    const own = rms[channel];
    const others = Object.entries(rms).filter(([c]) => c !== channel).map(([, db]) => db);
    if (own === undefined || others.length === 0) return false;
    return Math.abs(own - Math.max(...others)) >= CLEAR_MARGIN_DB;
  }

  private wallTs(): string {
    return new Date(this.now()).toISOString();
  }

  private publish(): void {
    this.o.onStatus({
      audio: this.stopped ? 'stopped' : 'ok',
      queue: this.queued,
      lastLatencyMs: this.lastLatencyMs,
      notices: [...this.notices],
      unconfirmed: [...this.unconfirmed].map(([utteranceId, v]) => ({ utteranceId, text: v.text, candidates: v.candidates })),
      newVoices: this.newVoices.map((v) => ({ label: v.label, utteranceIds: [...v.utteranceIds] })),
      failed: this.failed.map(({ job, reason }) => ({ channel: job.channel, startMs: job.u.startMs, endMs: job.u.endMs, reason })),
    });
  }
}
