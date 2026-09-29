import { Attributor, type Notice } from '../attribution/attributor';
import { CopyFilter, type Cut } from './copies';
import { confirmedEvent, lineEvents, loggedEndMs } from './runner-events';
import { type Job, type LiveRunnerOptions, utteranceId } from './runner-types';
import { VoiceGroups } from './voice-groups';

export { utteranceId, type LiveRunnerOptions, type LiveSetup, type LiveStatus } from './runner-types';

/**
 * A channel this far above every other one is unambiguous, so the voice match is skipped, but only
 * when everyone has their own mic and an enrolled voice (P2-R8): otherwise an unmiked speaker could
 * be loud on someone else's mic. Never while a channel is dead (P2-R10): its owner may be talking
 * into another mic.
 */
const CLEAR_MARGIN_DB = 12;
/** Every Nth skipped line is still matched after it is logged, only to notice crossed mics. */
const SWAP_SAMPLE_EVERY = 4;
/** Dropped copies waiting for their kept line to be logged; bounded in case a line was logged first. */
const COPIES_KEPT = 50;

export class LiveRunner {
  private readonly attributor: Attributor;
  private readonly now: () => number;
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private stopped = false;
  private lastLatencyMs: number | null = null;
  private recentLatencyMs: number[] = [];
  private notices: Notice[] = [];
  private readonly unconfirmed = new Map<string, { text: string; candidates: Record<string, number>; endMs: number }>();
  private readonly groups: VoiceGroups;
  private lastMediaMs = 0;
  private confirmSeq = 0;
  private readonly failed: { job: Job; reason: string }[] = [];
  private matchFailing = false;
  /** Kept line id → the ids of the quieter copies dropped for it (its overlapsWith). */
  private readonly copiesOf = new Map<string, string[]>();
  private readonly copies = new CopyFilter<Cut & { job: Job }>((kept, dropped) => this.noteCopy(kept, dropped));
  /** Voice matching may be skipped at clear margins (everyone miked and enrolled, tracks only). */
  private readonly mayskip: boolean;
  private skipped = 0;
  private sampling: Promise<void> = Promise.resolve();

  constructor(private readonly o: LiveRunnerOptions) {
    const { kind, channels, participants } = o.setup;
    const miked = new Set(Object.values(channels));
    const unmiked = participants.some((p) => !miked.has(p.key));
    const unenrolled = participants.some((p) => !o.anchors.some((a) => a.key === p.key));
    this.attributor = new Attributor(kind, channels, { unmiked });
    this.mayskip = kind === 'tracks' && !unmiked && !unenrolled;
    this.groups = new VoiceGroups((a, u) => o.voices.matchVoices(a, u));
    this.now = o.now ?? Date.now;
  }

  /**
   * Queues the utterance; ASR, matching and emission run one utterance at a time. Never rejects:
   * a failure lands in status.failed with the audio kept for `retry`. `endedAtWallMs` is when the
   * speech ended on the wall clock (the caller knows the tap start); without it latency counts from arrival.
   */
  onUtterance(channel: string, u: { startMs: number; endMs: number; pcm: Float32Array }, rms: Record<string, number>, overlap: boolean, endedAtWallMs?: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const job: Job = { channel, u, rms, overlap, arrivedAt: this.now(), ...(endedAtWallMs !== undefined ? { endedAt: endedAtWallMs } : {}) };
    if (this.o.setup.kind !== 'tracks') return this.enqueue(job);
    // Levels decide bleed before transcription: a quieter copy of someone else's speech is never a line.
    if (this.attributor.isBleed(channel, rms)) return Promise.resolve();
    const margin = this.attributor.margin(channel, rms);
    if (margin === null) return this.enqueue(job);
    return this.run(this.copies.offer({ channel, startMs: u.startMs, endMs: u.endMs, margin, job }));
  }

  /**
   * The kept line records the dropped copy (P2-R10); its confidence is untouched. A copy that arrives
   * after its kept line was logged is dropped without the marker: the log is append-only.
   */
  private noteCopy(kept: Cut, dropped: Cut): void {
    const id = utteranceId(kept.channel, kept.startMs);
    this.copiesOf.set(id, [...(this.copiesOf.get(id) ?? []), utteranceId(dropped.channel, dropped.startMs)]);
    if (this.copiesOf.size > COPIES_KEPT) this.copiesOf.delete(this.copiesOf.keys().next().value!);
  }

  private run(cuts: { job: Job }[]): Promise<void> {
    return Promise.all(cuts.map((c) => this.enqueue(c.job))).then(() => {});
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
    const mediaMs = held?.endMs ?? (await loggedEndMs(this.o.log, utteranceId)) ?? this.lastMediaMs;
    const eventId = `${this.o.sessionId}:${utteranceId}:confirmed:${this.now()}-${++this.confirmSeq}`;
    await this.o.log.append([confirmedEvent({ eventId, sessionId: this.o.sessionId, utteranceId, participantKey, mediaMs, wallTs: this.wallTs() })]);
    this.dismiss([utteranceId]);
  }

  /** Off the host's list without an event: the lines stay held, so they never reach the map. */
  dismiss(utteranceIds: string[]): void {
    for (const id of utteranceIds) this.unconfirmed.delete(id);
    this.groups.remove(utteranceIds);
    this.publish();
  }

  /** The host accepted a swap suggestion. */
  applySwap(a: string, b: string): void {
    this.attributor.applySwap(a, b);
  }

  tick(nowMs: number, active: Record<string, boolean>): void {
    void this.run(this.copies.release(nowMs));
    const fresh = this.attributor.tick(nowMs, active);
    if (fresh.length === 0) return;
    this.notices = [...this.notices, ...fresh];
    this.publish();
  }

  /** Waits for queued utterances to finish. Appends nothing: ending the session is the engine's finishSource(). */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.run(this.copies.flush());
    await this.chain;
    await this.sampling;
    this.publish();
  }

  private async process(job: Job): Promise<void> {
    const { channel, u, rms, overlap } = job;
    const { setup, sessionId } = this.o;
    const words = await this.o.asr.transcribe(u.pcm, u.startMs);
    if (words.length === 0) return;

    let voice: Record<string, number> = {};
    let matchFailed = false;
    const skip = this.mayskip && !this.attributor.hasDeadChannel() && (this.attributor.margin(channel, rms) ?? 0) >= CLEAR_MARGIN_DB;
    if (!skip) {
      try {
        // Enrolled voices only: temporary voices are matched separately, for grouping.
        voice = await this.o.voices.matchVoices(this.o.anchors, u.pcm);
        this.matchFailing = false;
      } catch {
        // The transcript is still good: it goes to the log as pending, and the host is told once per streak.
        matchFailed = true;
        if (!this.matchFailing) this.notices.push({ kind: 'voice_match_unavailable' });
        this.matchFailing = true;
      }
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

    const id = utteranceId(channel, u.startMs);
    const overlapsWith = this.copiesOf.get(id);
    this.copiesOf.delete(id);
    const { events, text, candidates } = lineEvents({ sessionId, id, u, words, decision, wallTs: this.wallTs(), ...(overlapsWith ? { overlapsWith } : {}) });
    await this.o.log.append(events);

    this.lastMediaMs = u.endMs;
    if (decision.pending) this.unconfirmed.set(id, { text, candidates, endMs: u.endMs });
    for (const n of notices) {
      if (n.kind !== 'new_voice') this.notices.push(n);
      else if (!matchFailed) await this.groups.add(id, u.pcm);
    }
    if (skip && ++this.skipped % SWAP_SAMPLE_EVERY === 0) this.sampleSwap(channel, u.pcm);
    this.lastLatencyMs = this.now() - (job.endedAt ?? job.arrivedAt);
    this.recentLatencyMs = [...this.recentLatencyMs, this.lastLatencyMs].slice(-3);
    this.publish();
  }

  /** Off the critical path: the line is already logged; the match only feeds swap detection. */
  private sampleSwap(channel: string, pcm: Float32Array): void {
    this.sampling = this.sampling.then(async () => {
      try {
        const found = this.attributor.observeVoice(channel, await this.o.voices.matchVoices(this.o.anchors, pcm));
        if (found.length === 0) return;
        this.notices.push(...found);
        this.publish();
      } catch {
        // A missed sample only delays a swap suggestion; the lines themselves were decided by margin.
      }
    });
  }

  private wallTs(): string {
    return new Date(this.now()).toISOString();
  }

  private publish(): void {
    this.o.onStatus({
      audio: this.stopped ? 'stopped' : 'ok',
      queue: this.queued,
      lastLatencyMs: this.lastLatencyMs,
      recentLatencyMs: [...this.recentLatencyMs],
      notices: [...this.notices],
      unconfirmed: [...this.unconfirmed].map(([utteranceId, v]) => ({ utteranceId, text: v.text, candidates: v.candidates })),
      newVoices: this.groups.groups.map((v) => ({ label: v.label, utteranceIds: [...v.utteranceIds] })),
      failed: this.failed.map(({ job, reason }) => ({ channel: job.channel, startMs: job.u.startMs, endMs: job.u.endMs, reason })),
    });
  }
}
