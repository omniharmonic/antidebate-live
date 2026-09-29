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
import type { EventLog } from './log';

export interface EngineOptions {
  sessionId: string;
  log: EventLog;
  /** Live: close an open turn after this much silence (wall ms). */
  silenceMs?: number;
  /** Run L3 + L4 after this many debater turns, at every round change, or after `insightEveryMs` of media time. */
  insightEveryTurns?: number;
  insightEveryMs?: number;
  pollMs?: number;
  onCall?: (l: LlmCallLog) => void;
  say?: (line: string) => void;
}

const now = () => new Date().toISOString();

export class SessionEngine {
  private state: SessionState;
  private cursor = 0;
  private buffer: TurnBuffer;
  private queue: Turn[] = [];
  private turns: Turn[] = [];
  private own = new Set<string>();
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
  private recentCards: { cruxPropositionId?: string; cruxHistory: string[]; higherGround: string[]; prompts: string[] } = { cruxHistory: [], higherGround: [], prompts: [] };
  private readonly opts: Required<Omit<EngineOptions, 'onCall' | 'say'>> & Pick<EngineOptions, 'onCall' | 'say'>;

  constructor(opts: EngineOptions) {
    this.opts = { silenceMs: 3500, insightEveryTurns: 6, insightEveryMs: 240_000, pollMs: 400, ...opts };
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
    for (const e of events) {
      this.own.add(e.eventId);
      this.state = apply(this.state, e);
    }
    await this.opts.log.append(events);
  }

  private ingest(events: DomainEvent[]) {
    for (const e of events) {
      if (this.own.has(e.eventId)) continue;
      this.state = apply(this.state, e);
      if (e.type === 'utterance.final') {
        this.lastUtteranceWall = Date.now();
        for (const t of this.buffer.push(e.payload.utterance)) this.queue.push(t);
      }
    }
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

  private async processTurn(turn: Turn) {
    const role = this.roleOf(turn.participantKey);
    if (this.turns.length === 0) this.lastInsightMediaMs = turn.startMs; // cadence starts with the session, not at 0
    this.processedMediaMs = Math.max(this.processedMediaMs, turn.endMs);
    this.turns.push(turn);
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
      if (r.events.some((e) => e.type === 'round.started')) {
        this.say(`round → ${this.state.round?.name}`);
        this.insightWanted = true; // cards at every round boundary (PRD §9)
      }
      return;
    }
    if (role !== 'debater') return; // unknown speakers never enter the map

    const participants = this.state.participants.map(({ key, displayName }) => ({ key, displayName }));
    const recent = this.turns.slice(-4, -1);
    const l1 = await runL1(turn, {
      sessionId: this.opts.sessionId,
      participants,
      round: this.state.round?.name ?? null,
      recentTurns: recent,
      propositionIndex: this.boundedIndexFor(turn.participantKey),
      utterances: this.state.utterances,
      wallTs: now,
    });
    this.logCall(l1.log);
    if (l1.error) this.say(`L1 ${turn.turnId}: ${l1.error}`);
    await this.append(l1.events);

    const index = new Map(this.indexForL1().map((p) => [p.id, p.canonical]));
    const l2 = await runL2(turn, l1.events, { sessionId: this.opts.sessionId, participants, recentTurns: recent, index, wallTs: now });
    this.logCall(l2.log);
    if (l2.error) this.say(`L2 ${turn.turnId}: ${l2.error}`);
    await this.append(l2.events);
    const approvals = approvalEvents(turn, l1.events, l2.verdicts, this.approvedPropIds(), { sessionId: this.opts.sessionId, wallTs: now() });
    await this.append(approvals);

    const approved = approvals.filter((e) => e.type === 'item.approved').length;
    const rejected = approvals.filter((e) => e.type === 'item.rejected').length;
    const lat = (l1.log.latencyMs + (l2.log?.latencyMs ?? 0)) / 1000;
    this.say(`${turn.turnId} ${turn.participantKey} ${(turn.startMs / 60000).toFixed(1)}m · L1+L2 ${lat.toFixed(1)}s · +${approved} approved, ${rejected} rejected`);
    this.turnsSinceInsight += 1;
    if (this.turnsSinceInsight >= this.opts.insightEveryTurns || turn.endMs - this.lastInsightMediaMs >= this.opts.insightEveryMs) this.insightWanted = true;
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
    this.lastInsightMediaMs = mediaMs;
    this.insightRunning = (async () => {
      const t0 = Date.now();
      let view = buildMapView(this.state);
      const newIds = new Set([...view.props.keys()].filter((id) => !this.linkedIds.has(id)));
      const l3 = await runL3(view, newIds, { sessionId: this.opts.sessionId, seq, mediaMs, wallTs: now });
      this.logCall(l3.log);
      if (l3.error) this.say(`L3: ${l3.error}`);
      await this.append(l3.events);
      for (const id of newIds) this.linkedIds.add(id);

      view = buildMapView(this.state);
      const names = new Map(this.state.participants.map((p) => [p.key, p.displayName]));
      const recent = this.turns.slice(-6).map((t) => ({ speaker: names.get(t.participantKey) ?? t.participantKey, text: t.text }));
      const l4 = await runL4(view, {
        sessionId: this.opts.sessionId,
        seq,
        mediaMs,
        formatId: this.formatId,
        roundId: this.state.round?.roundId ?? null,
        recent,
        previous: this.previous,
        previousShared: this.previousShared,
        recentCards: this.recentCards,
        wallTs: now,
      });
      this.logCall(l4.log);
      if (l4.error) this.say(`L4: ${l4.error}`);
      await this.append(l4.events);
      this.previousShared = l4.sharedKey;
      for (const e of l4.events) {
        if (e.type !== 'insight.proposed') continue;
        const b = e.payload.insight.body as { statement?: string; text?: string; propositionId?: string };
        if (e.payload.insight.kind === 'crux') {
          if (this.recentCards.cruxPropositionId) this.recentCards.cruxHistory = [...this.recentCards.cruxHistory.slice(-2), this.recentCards.cruxPropositionId];
          this.recentCards.cruxPropositionId = b.propositionId;
        }
        if (e.payload.insight.kind === 'higher_ground') this.recentCards.higherGround = [...this.recentCards.higherGround.slice(-5), b.text ?? ''];
        if (e.payload.insight.kind === 'prompt') this.recentCards.prompts = [...this.recentCards.prompts.slice(-8), b.text ?? ''];
        if (e.payload.insight.kind === 'crux') this.previous.crux = b.statement;
        if (e.payload.insight.kind === 'higher_ground') this.previous.higherGround = [...(this.previous.higherGround ?? []).slice(-1), b.text ?? ''];
        if (e.payload.insight.kind === 'prompt') this.previous.prompts = [...(this.previous.prompts ?? []).slice(-2), b.text ?? ''];
      }
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
      if (this.stopped) break;
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
        await this.append([{ eventId: `${this.opts.sessionId}:end`, sessionId: this.opts.sessionId, type: 'session.ended', actor: 'system', mediaMs: this.state.lastMediaMs, wallTs: now(), payload: {} }]);
        break;
      }
      await new Promise((r) => setTimeout(r, this.opts.pollMs));
    }
  }
}
