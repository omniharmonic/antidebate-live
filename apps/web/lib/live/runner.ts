import type { DomainEvent } from '@adl/core';
import type { EventLog } from '@adl/engine';
import type { AsrClient } from '../asr/client';
import type { Anchor } from '../attribution/anchors';
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
};

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
  /** Labels are never reused, even after their utterances are confirmed away. */
  private voiceCount = 0;

  constructor(private readonly o: LiveRunnerOptions) {
    this.attributor = new Attributor(o.setup.kind, o.setup.channels);
    this.now = o.now ?? Date.now;
  }

  /** Queues the utterance; ASR, matching and emission run one utterance at a time. Rejects if this utterance failed. */
  onUtterance(channel: string, u: { startMs: number; endMs: number; pcm: Float32Array }, rms: Record<string, number>, overlap: boolean): Promise<void> {
    const arrivedAt = this.now();
    this.queued += 1;
    this.publish();
    const job = this.chain.then(() => this.process(channel, u, rms, overlap, arrivedAt));
    const settled = job.then(
      () => undefined,
      () => undefined,
    );
    this.chain = settled.then(() => {
      this.queued -= 1;
      this.publish();
    });
    return job;
  }

  async confirm(utteranceId: string, participantKey: string): Promise<void> {
    const held = this.unconfirmed.get(utteranceId);
    await this.o.log.append([
      {
        eventId: `${this.o.sessionId}:${utteranceId}:confirmed:${participantKey}`,
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
    await this.chain;
    this.stopped = true;
    this.publish();
  }

  private async process(channel: string, u: { startMs: number; endMs: number; pcm: Float32Array }, rms: Record<string, number>, overlap: boolean, arrivedAt: number): Promise<void> {
    const { setup, sessionId, log } = this.o;
    const words = await this.o.asr.transcribe(u.pcm, u.startMs);
    if (words.length === 0) return;

    const voice = this.isUnambiguous(channel, rms) ? {} : await this.o.voices.matchVoices(this.o.anchors, u.pcm);
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
      if (n.kind === 'new_voice') this.newVoices.push({ label: `Voice ${++this.voiceCount}`, utteranceIds: [id] });
      else this.notices.push(n);
    }
    // The utterance reached us at (about) its end; this is how long attribution took after that.
    this.lastLatencyMs = this.now() - arrivedAt;
    this.publish();
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
    });
  }
}
