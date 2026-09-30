/**
 * The session engine: one loop for live rooms and replays (docs/R0_DEMO.md).
 * It tails the event log, builds turns from `utterance.final` events, and runs
 *   moderator turn → round detection
 *   debater turn   → L1 extract → L2 critic → auto-approval rule
 *   periodically   → L3 link → L4 insight (in the background, never blocking L1)
 * Everything it learns is appended back to the log. It never reads the clock into
 * the log except as `wallTs`, so playback stays deterministic.
 */
import { apply, emptyState, type DomainEvent, type SessionState } from '@adl/core';
import type { LlmCallLog } from '@adl/llm';
import {
  approvalEvents,
  buildMapView,
  detectRound,
  runL1,
  runL2,
  runL3,
  runL4,
  TurnBuffer,
  type PreviousCards,
  type Turn,
} from '@adl/pipeline';
import type { EventLog } from './types';

type Utterance = SessionState['utterances'] extends Map<string, infer U> ? U : never;

export interface EngineOptions {
  sessionId: string;
  log: EventLog;
  /** Live: close an open turn after this much silence (wall ms). */
  silenceMs?: number;
  /** Run L3 + L4 after this many debater turns, at every round change, or after `insightEveryMs` of media time. */
  insightEveryTurns?: number;
  insightEveryMs?: number;
  pollMs?: number;
  /** Hold utterances awaiting host confirmation out of the map until confirmed (default true). */
  holdPending?: boolean;
  onCall?: (l: LlmCallLog) => void;
  /** Called once per loop tick. */
  onProgress?: (p: { processedMediaMs: number; queued: number; insightRunning: boolean }) => void;
  say?: (line: string) => void;
}

const now = () => new Date().toISOString();

/** Event types runL1 writes for a turn, all with ids under the turn id. */
const L1_TYPES = new Set<DomainEvent['type']>(['adu.proposed', 'proposition.proposed', 'stance.proposed', 'relation.proposed', 'validation.result']);

export class SessionEngine {
  private state: SessionState;
  private cursor = 0;
  private buffer: TurnBuffer;
  private queue: Turn[] = [];
  private turns: Turn[] = [];
  private own = new Set<string>();
  /** Unconfirmed utterances, held out of the turn buffer until `attribution.confirmed`. */
  private parked = new Map<string, Utterance>();
  /** Turns a previous run closed, in order (resume after a reload). */
  private closedBefore: string[] = [];
  /** Ids of L1 events a previous run wrote (`<turnId>:<ref>:…`). */
  private l1Before: DomainEvent[] = [];
  private completedBefore = new Set<string>();
  private seenEvents = new Set<string>();
  /** Logged turn boundaries (resume): utterance id → the turn it opens / closes. */
  private loggedStart = new Map<string, string>();
  private loggedEnd = new Map<string, string>();
  private lastUtteranceWall = Date.now();
  private sourceDone = false;
  private stopped = false;
  // insight cadence
  private turnsSinceInsight = 0;
  private lastInsightMediaMs = 0;
  /** End of the last processed turn: at --speed max the log runs far ahead of processing. */
  private processedMediaMs = 0;
  private insightSeq = 0;
  private insightRunning: Promise<void> | null = null;
  private insightWanted = false;
  private linkedIds = new Set<string>();
  private previous: PreviousCards = {};
  private previousShared = '';
  private recentCards: { cruxPropositionId?: string; cruxFingerprint?: string; cruxHistory: string[]; lastBlockedCrux?: string; higherGround: string[]; prompts: string[] } = { cruxHistory: [], higherGround: [], prompts: [] };
  private readonly opts: Required<Omit<EngineOptions, 'onCall' | 'onProgress' | 'say'>> & Pick<EngineOptions, 'onCall' | 'onProgress' | 'say'>;

  constructor(opts: EngineOptions) {
    this.opts = { silenceMs: 3500, insightEveryTurns: 6, insightEveryMs: 240_000, pollMs: 400, holdPending: true, ...opts };
    this.state = emptyState(opts.sessionId);
    this.buffer = new TurnBuffer(opts.sessionId);
  }

  private say(line: string) {
    this.opts.say?.(line);
  }

  /** The replay feeder (or the live room) is finished: flush and drain. */
  finishSource() {
    this.sourceDone = true;
  }

  stop() {
    this.stopped = true;
  }

  private get formatId() {
    return this.state.formatId ?? 'open';
  }

  private async append(events: DomainEvent[]) {
    if (events.length === 0) return;
    await this.opts.log.append(events);
    for (const e of events) {
      this.seenEvents.add(e.eventId);
      this.own.add(e.eventId);
      this.state = apply(this.state, e);
    }
  }

  /**
   * Turn boundaries a previous run logged. Replaying the log through the buffer alone would merge
   * turns that closed on silence, so their ids would shift onto different lines and new turns would
   * reuse logged ids (and be skipped as finished). Fresh logs (the worker's replay) have none.
   */
  private scanLoggedTurns(events: DomainEvent[]) {
    for (const e of events) {
      if (e.type !== 'turn.closed' || this.own.has(e.eventId)) continue;
      const { turnId, utteranceIds } = e.payload;
      if (utteranceIds.length === 0) continue;
      this.loggedStart.set(utteranceIds[0]!, turnId);
      this.loggedEnd.set(utteranceIds.at(-1)!, turnId);
      const seq = /:t(\d+)$/.exec(turnId);
      if (seq) this.buffer.resumeAfter(Number(seq[1]));
    }
  }

  /** Into the turn buffer, closing turns where a previous run closed them. */
  private pushUtterance(u: Utterance) {
    if (this.loggedStart.has(u.id)) {
      const t = this.buffer.flush();
      if (t) this.queue.push(t);
    }
    for (const t of this.buffer.push(u)) this.queue.push(t);
    const end = this.loggedEnd.get(u.id);
    if (end) {
      const t = this.buffer.flush(end);
      if (t) this.queue.push(t);
    }
  }

  private ingest(events: DomainEvent[]) {
    this.scanLoggedTurns(events);
    for (const e of events) {
      if (this.own.has(e.eventId)) continue;
      this.seenEvents.add(e.eventId);
      this.state = apply(this.state, e);
      if (e.type === 'turn.closed') this.closedBefore.push(e.payload.turnId);
      if (L1_TYPES.has(e.type)) this.l1Before.push(e);
      if (e.type === 'analysis.completed') this.completedBefore.add(`${e.payload.turnId}:${e.payload.stage}`);
      this.resumeInsight(e);
      if (e.type === 'utterance.final') {
        this.lastUtteranceWall = Date.now();
        const u = e.payload.utterance;
        if (this.opts.holdPending && this.state.pendingAttribution.has(u.id)) {
          this.parked.set(u.id, u);
          continue;
        }
        this.pushUtterance(u);
      }
      if (e.type === 'attribution.confirmed' && this.parked.has(e.payload.utteranceId)) {
        const u = this.state.utterances.get(e.payload.utteranceId)!; // the reducer already applied the confirmed speaker
        this.parked.delete(u.id);
        this.lastUtteranceWall = Date.now();
        this.pushUtterance(u);
      }
    }
  }

  /**
   * Insight state from a previous run's events (resume after a reload). L3/L4 event ids
   * carry the pass number, so a new pass must number after the last one or its events
   * collide with ids already in the log and are dropped. Propositions present at that
   * pass were already linked, and its cards feed the stability rules.
   */
  private resumeInsight(e: DomainEvent) {
    const prefix = `${this.opts.sessionId}:l`;
    const m = e.eventId.startsWith(prefix) ? /^[34]:(\d+)/.exec(e.eventId.slice(prefix.length)) : null;
    if (!m) return;
    this.insightSeq = Math.max(this.insightSeq, Number(m[1]) + 1);
    for (const p of this.state.propositions.values()) this.linkedIds.add(p.value.id);
    if (e.type === 'insight.proposed') this.rememberCard(e.payload.insight.kind, e.payload.insight.body);
  }

  /** Keep recent cards for L4's stability rules and prompt context. */
  private rememberCard(kind: string, body: unknown) {
    const b = body as { statement?: string; text?: string; propositionId?: string };
    if (kind === 'crux') {
      if (this.recentCards.cruxPropositionId) this.recentCards.cruxHistory = [...this.recentCards.cruxHistory.slice(-2), this.recentCards.cruxPropositionId];
      this.recentCards.cruxPropositionId = b.propositionId;
      this.recentCards.cruxFingerprint = JSON.stringify(body);
      this.previous.crux = b.statement;
    }
    if (kind === 'higher_ground') {
      this.recentCards.higherGround = [...this.recentCards.higherGround.slice(-5), b.text ?? ''];
      this.previous.higherGround = [...(this.previous.higherGround ?? []).slice(-1), b.text ?? ''];
    }
    if (kind === 'prompt') {
      this.recentCards.prompts = [...this.recentCards.prompts.slice(-8), b.text ?? ''];
      this.previous.prompts = [...(this.previous.prompts ?? []).slice(-2), b.text ?? ''];
    }
    // The shared card's body is the key runL4 compares against (JSON of the same object).
    if (kind === 'shared') this.previousShared = JSON.stringify(body);
  }

  private roleOf(key: string) {
    return this.state.participants.find((p) => p.key === key)?.role;
  }

  private approvedPropIds(): Set<string> {
    const ids = new Set<string>();
    for (const p of this.state.propositions.values()) if (p.state === 'approved' || p.state === 'released') ids.add(p.value.id);
    return ids;
  }

  /** Every live proposition (for the critic's lookups; not sent to L1 in full). */
  private indexForL1() {
    return [...this.state.propositions.values()]
      .filter((p) => p.state !== 'rejected' && p.state !== 'merged')
      .map((p) => ({ id: p.value.id, canonical: p.value.canonical }));
  }

  /**
   * The bounded index L1 sees: the other debaters' most recent claims (what this
   * turn may answer or repeat) and the speaker's own recent claims. Flat cost per
   * turn instead of growing with the debate; L3 catches duplicates beyond it.
   */
  private boundedIndexFor(speakerKey: string, limit = 60) {
    const heldBy = new Map<string, Set<string>>();
    for (const s of this.state.stances.values()) {
      if (s.state === 'rejected' || s.state === 'merged') continue;
      if (!heldBy.has(s.value.propositionId)) heldBy.set(s.value.propositionId, new Set());
      heldBy.get(s.value.propositionId)!.add(s.value.participantKey);
    }
    const names = new Map(this.state.participants.map((p) => [p.key, p.displayName]));
    const label = (id: string) => [...(heldBy.get(id) ?? [])].map((k) => names.get(k) ?? k).join(', ');
    const all = this.indexForL1().reverse(); // newest first
    const others = all.filter((p) => ![...(heldBy.get(p.id) ?? [])].every((k) => k === speakerKey));
    const own = all.filter((p) => !others.includes(p));
    return [...others.slice(0, Math.round(limit * 0.66)), ...own.slice(0, limit - Math.round(limit * 0.66))]
      .reverse()
      .map((p) => ({ ...p, ...(label(p.id) ? { heldBy: `held by ${label(p.id)}` } : {}) }));
  }

  private logCall(l: LlmCallLog | null) {
    if (!l) return;
    this.opts.onCall?.(l);
    void this.opts.log.logCall(l).catch(() => {});
  }

  /** Only durable completion (or all legacy item decisions), never a later turn, proves completion. */
  private finishedBefore(turnId: string) {
    if (this.completedBefore.has(`${turnId}:L2`) || this.completedBefore.has(`${turnId}:round`)) return true;
    const items = this.l1Before.filter(e => e.eventId.startsWith(`${turnId}:`)).flatMap<{ state: string } | undefined>(e =>
      e.type === 'proposition.proposed' ? [this.state.propositions.get(e.payload.proposition.id)] :
      e.type === 'stance.proposed' ? [this.state.stances.get(e.payload.stance.id)] : []);
    return items.length > 0 && items.every(x => x && x.state !== 'proposed');
  }

  private async checkpoint(turn: Turn, stage: 'L1' | 'L2' | 'round') {
    await this.append([{ eventId: `${turn.turnId}:complete:${stage}`, sessionId: this.opts.sessionId, type: 'analysis.completed', actor: 'system', mediaMs: turn.endMs, wallTs: now(), payload: { turnId: turn.turnId, stage } }]);
  }

  private async processTurn(turn: Turn) {
    const role = this.roleOf(turn.participantKey);
    if (this.turns.length === 0) this.lastInsightMediaMs = turn.startMs; // cadence starts with the session, not at 0
    this.processedMediaMs = Math.max(this.processedMediaMs, turn.endMs);
    this.turns.push(turn);
    if (this.finishedBefore(turn.turnId)) return;
    await this.append([
      {
        eventId: `${turn.turnId}:closed`,
        sessionId: this.opts.sessionId,
        type: 'turn.closed',
        actor: 'system',
        mediaMs: turn.endMs,
        wallTs: now(),
        payload: { turnId: turn.turnId, participantKey: turn.participantKey, utteranceIds: turn.utterances.map((u) => u.id) },
      },
    ]);

    if (role === 'moderator') {
      const before = this.state.round?.roundId ?? null;
      const previousModeratorTurns = this.turns.filter((t) => t !== turn && this.roleOf(t.participantKey) === 'moderator').slice(-3).map((t) => t.text);
      const r = await detectRound(turn, { sessionId: this.opts.sessionId, formatId: this.formatId, currentRoundId: before, currentRoundStartedMs: this.state.round?.startedMediaMs ?? null, previousModeratorTurns, wallTs: now });
      this.logCall(r.log);
      await this.append(r.events);
      if (!r.error) await this.checkpoint(turn, 'round');
      if (r.events.some((e) => e.type === 'round.started')) {
        this.say(`round → ${this.state.round?.name}`);
        this.insightWanted = true; // cards at every round boundary (PRD §9)
      }
      return;
    }
    if (role !== 'debater') return; // unknown speakers never enter the map
    this.turnsSinceInsight += 1;
    if (this.turnsSinceInsight >= this.opts.insightEveryTurns || turn.endMs - this.lastInsightMediaMs >= this.opts.insightEveryMs) this.insightWanted = true;

    const participants = this.state.participants.map(({ key, displayName }) => ({ key, displayName }));
    const recent = this.turns.slice(-4, -1);
    const storedL1 = this.l1Before.filter(e => e.eventId.startsWith(`${turn.turnId}:`));
    const l1 = storedL1.length || this.completedBefore.has(`${turn.turnId}:L1`) ? { events: storedL1, log: null, error: undefined } : await runL1(turn, {
      sessionId: this.opts.sessionId,
      participants,
      round: this.state.round?.name ?? null,
      recentTurns: recent,
      propositionIndex: this.boundedIndexFor(turn.participantKey),
      utterances: this.state.utterances,
      wallTs: now,
    });
    this.logCall(l1.log);
    if (l1.error) { this.say(`L1 ${turn.turnId}: ${l1.error}`); return; }
    if (!storedL1.length) await this.append(l1.events);
    await this.checkpoint(turn, 'L1');

    const index = new Map(this.indexForL1().map((p) => [p.id, p.canonical]));
    const l2 = await runL2(turn, l1.events, { sessionId: this.opts.sessionId, participants, recentTurns: recent, index, wallTs: now });
    this.logCall(l2.log);
    if (l2.error) { this.say(`L2 ${turn.turnId}: ${l2.error}`); return; }
    // If a previous attempt persisted only some critic events, retain those and append a new reviewed decision.
    const freshId = (e: DomainEvent): DomainEvent => { let id = e.eventId, n = 1; while (this.seenEvents.has(id)) id = `${e.eventId}:retry${n++}`; return { ...e, eventId: id }; };
    await this.append(l2.events.map(freshId));
    const approvals = approvalEvents(turn, l1.events, l2.verdicts, this.approvedPropIds(), { sessionId: this.opts.sessionId, wallTs: now() });
    await this.append(approvals.map(freshId));
    await this.checkpoint(turn, 'L2');

    const approved = approvals.filter((e) => e.type === 'item.approved').length;
    const rejected = approvals.filter((e) => e.type === 'item.rejected').length;
    const lat = ((l1.log?.latencyMs ?? 0) + (l2.log?.latencyMs ?? 0)) / 1000;
    this.say(`${turn.turnId} ${turn.participantKey} ${(turn.startMs / 60000).toFixed(1)}m · L1+L2 ${lat.toFixed(1)}s · +${approved} approved, ${rejected} rejected`);
  }

  /** L3 then L4 on a snapshot of the approved map. One at a time, in the background. */
  private startInsight() {
    if (this.insightRunning || !this.insightWanted) return;
    // Cards need something to work with: at least a few approved claims.
    const drained = this.sourceDone && this.queue.length === 0;
    if (buildMapView(this.state).props.size < 3 && !drained) return;
    this.insightWanted = false;
    this.turnsSinceInsight = 0;
    const seq = this.insightSeq++;
    const mediaMs = this.processedMediaMs;
    const snapshot = structuredClone(this.state);
    const snapshotTurns = this.turns.slice(-6);
    this.lastInsightMediaMs = mediaMs;
    this.insightRunning = (async () => {
      const t0 = Date.now();
      let view = buildMapView(snapshot);
      const newIds = new Set([...view.props.keys()].filter((id) => !this.linkedIds.has(id)));
      const l3 = await runL3(view, newIds, { sessionId: this.opts.sessionId, seq, mediaMs, wallTs: now, onReviewCall: l => this.logCall(l) });
      this.logCall(l3.log);
      if (l3.error) this.say(`L3: ${l3.error}`);
      await this.append(l3.events);
      if (!l3.error) for (const id of newIds) this.linkedIds.add(id);

      for (const event of l3.events) apply(snapshot, event);
      view = buildMapView(snapshot);
      const names = new Map(snapshot.participants.map((p) => [p.key, p.displayName]));
      const recent = snapshotTurns.map((t) => ({ speaker: names.get(t.participantKey) ?? t.participantKey, text: t.text }));
      const l4 = await runL4(view, {
        sessionId: this.opts.sessionId,
        seq,
        mediaMs,
        formatId: snapshot.formatId ?? 'open',
        roundId: snapshot.round?.roundId ?? null,
        recent,
        previous: this.previous,
        previousShared: this.previousShared,
        onReviewCall: l => this.logCall(l),
        recentCards: this.recentCards,
        wallTs: now,
      });
      this.logCall(l4.log);
      if (l4.error) this.say(`L4: ${l4.error}`);
      await this.append(l4.events);
      this.previousShared = l4.sharedKey;
      for (const e of l4.events) if (e.type === 'insight.proposed' && e.payload.insight.kind !== 'shared') this.rememberCard(e.payload.insight.kind, e.payload.insight.body);
      const kinds = l4.events.filter((e) => e.type === 'insight.proposed').map((e) => (e.type === 'insight.proposed' ? e.payload.insight.kind : ''));
      this.say(`insight #${seq} @${(mediaMs / 60000).toFixed(1)}m · ${view.props.size} props, ${view.disagreements.length} disagreements, ${view.clashes.length} clashes, ${view.commonGround.length} shared · ${kinds.join(', ') || 'no cards'} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    })()
      .catch((err: unknown) => this.say(`insight failed: ${(err as Error).message}`))
      .finally(() => {
        this.insightRunning = null;
      });
  }

  /** Run until the source is finished and all work is drained (replay), or until stopped (live). */
  async run(): Promise<void> {
    let working: Promise<void> | null = null;
    for (;;) {
      if (this.stopped) {
        // Let the work in flight land in the log, so the caller's close() can deliver it.
        await working;
        await this.insightRunning;
        break;
      }
      const { cursor, events } = await this.opts.log.read(this.cursor);
      this.cursor = cursor;
      this.ingest(events);

      const idle = Date.now() - this.lastUtteranceWall > this.opts.silenceMs;
      if ((idle || this.sourceDone) && this.queue.length === 0 && !working) {
        const t = this.buffer.flush();
        if (t) this.queue.push(t);
      }
      if (!working && this.queue.length) {
        const turn = this.queue.shift()!;
        working = this.processTurn(turn)
          .catch((err: unknown) => this.say(`turn ${turn.turnId} failed: ${(err as Error).message}`))
          .finally(() => {
            working = null;
          });
      }
      this.startInsight();

      if (this.sourceDone && !working && this.queue.length === 0 && !this.insightRunning) {
        // Final cards, then close the session.
        if (this.turnsSinceInsight > 0 || this.insightSeq === 0) {
          this.insightWanted = true;
          this.startInsight();
          await this.insightRunning;
        }
        if (this.stopped) break; // stopped during the final cards (a rejected key): the session is not finished
        await this.append([{ eventId: `${this.opts.sessionId}:end`, sessionId: this.opts.sessionId, type: 'session.ended', actor: 'system', mediaMs: this.state.lastMediaMs, wallTs: now(), payload: {} }]);
        break;
      }
      this.opts.onProgress?.({ processedMediaMs: this.processedMediaMs, queued: this.queue.length, insightRunning: Boolean(this.insightRunning) });
      await this.pause(working);
    }
  }

  /**
   * Between loop ticks. With work queued or the source finished, wait for the work rather
   * than a timer: a background tab runs timers about once a minute, which would otherwise
   * cost a minute per turn. A live source still polls for new utterances.
   */
  private async pause(working: Promise<void> | null) {
    if (working && (this.sourceDone || this.queue.length > 0)) return void (await working);
    if (this.sourceDone && this.queue.length > 0) return;
    if (this.sourceDone && this.insightRunning) return void (await this.insightRunning);
    await new Promise((r) => setTimeout(r, this.opts.pollMs));
  }
}
