import { AUTO_THRESHOLD, fuse } from './fusion';
import { capVoiceOnly } from './gate';

export type Setup = 'tracks' | 'call' | 'room';
/** channel id → participant key */
export type ChannelMap = Record<string, string>;
export type UtteranceSignals = {
  /** Capture channel the utterance was cut from. */
  channel: string | null;
  /** Every channel's RMS over the utterance span. */
  channelRmsDb: Record<string, number>;
  /** Participant key → voice-match fraction 0..1 (may be empty). */
  voice: Record<string, number>;
  overlap: boolean;
  startMs: number;
  endMs: number;
};
/**
 * Whenever `pending` is true, `participantKey` is 'UNK' and the best guess (if any) is in `candidate`.
 * Non-pending decisions carry the attributed key.
 */
export type Decision = {
  participantKey: string;
  candidate?: string;
  /** Held lines with more than one plausible speaker (the host's choices), else just `candidate`. */
  candidates?: Record<string, number>;
  confidence: number;
  pending: boolean;
  signals: { channel?: string; voiceprint?: Record<string, number> };
  drop?: 'bleed';
};
export type Notice = { kind: 'dead_channel' | 'channel_recovered' | 'swap_suggested' | 'new_voice' | 'voice_match_unavailable'; channel?: string; participantKey?: string; label?: string };

const BLEED_DB = 6;
const VOICE_LEAD = 0.2;
const NEW_VOICE_BELOW = 0.5;
const DEAD_MS = 60_000;
const SWAP_STREAK = 5;
const SWAP_VOICE = 0.7;
/** In the tracks setup, a line auto-accepts only when its channel owner is also the best voice at this share. */
const OWNER_VOICE = 0.5;
/** Held lines carry a confidence just below the auto threshold at most. */
const HELD_MAX = Math.round((AUTO_THRESHOLD - 0.01) * 100) / 100;

function best(voice: Record<string, number>): [string, number] | null {
  let top: [string, number] | null = null;
  for (const [k, v] of Object.entries(voice)) if (!top || v > top[1]) top = [k, v];
  return top;
}

export class Attributor {
  private owners: ChannelMap;
  private readonly dead = new Set<string>();
  private readonly firstSeen = new Map<string, number>();
  private readonly lastActive = new Map<string, number>();
  private readonly mismatch = new Map<string, number>();
  private voiceLabels = 0;
  private readonly unmiked: boolean;

  /** `unmiked`: someone has no input of their own, so a clean margin alone cannot rule them out. */
  constructor(
    readonly setup: Setup,
    channels: ChannelMap,
    opts: { unmiked?: boolean } = {},
  ) {
    this.owners = { ...channels };
    this.unmiked = opts.unmiked ?? false;
  }

  /** The utterance channel's level above the loudest other channel, or null when there is no usable margin. */
  margin(channel: string | null, channelRmsDb: Record<string, number>): number | null {
    if (!channel || this.owners[channel] === undefined || this.dead.has(channel)) return null;
    const own = channelRmsDb[channel];
    const others = Object.entries(channelRmsDb).filter(([c]) => c !== channel).map(([, db]) => db);
    return own === undefined || others.length === 0 ? null : own - Math.max(...others);
  }

  /** Some mic has gone quiet: its owner may be talking into another one, so no margin is proof alone. */
  hasDeadChannel(): boolean {
    return this.dead.size > 0;
  }

  /** A quieter copy of speech on another mic: dropped before transcription. */
  isBleed(channel: string | null, channelRmsDb: Record<string, number>): boolean {
    const m = this.margin(channel, channelRmsDb);
    return m !== null && m <= -BLEED_DB;
  }

  /** A voice match run only to watch for crossed mics (sampled at clear margins, after the line is logged). */
  observeVoice(channel: string, voice: Record<string, number>): Notice[] {
    const owner = this.owners[channel];
    const notices: Notice[] = [];
    if (owner !== undefined && !this.dead.has(channel)) this.trackMismatch(channel, owner, best(voice), notices);
    return notices;
  }

  decide(s: UtteranceSignals): { decision: Decision; notices: Notice[] } {
    const notices: Notice[] = [];
    const signals: Decision['signals'] = {};
    if (s.channel) signals.channel = s.channel;
    if (Object.keys(s.voice).length) signals.voiceprint = s.voice;

    const owner = s.channel ? this.owners[s.channel] : undefined;
    const top = best(s.voice);

    if (!s.channel || owner === undefined) {
      // One mixed feed, or an unmapped channel: the voice match is all there is.
      if (!top || top[1] < NEW_VOICE_BELOW) {
        this.voiceLabels += 1;
        notices.push({ kind: 'new_voice', label: `Voice ${this.voiceLabels}` });
        const fused = fuse({ channelMarginDb: null, voiceMatch: top ? top[1] : null, diarizerAgrees: null, overlap: s.overlap });
        return { decision: { participantKey: 'UNK', confidence: Math.min(0.6, fused), pending: true, signals }, notices };
      }
      const fused = capVoiceOnly(this.setup, fuse({ channelMarginDb: null, voiceMatch: top[1], diarizerAgrees: null, overlap: s.overlap }));
      return { decision: this.finish(top[0], fused, signals), notices };
    }

    const channel = s.channel;
    const ownDb = s.channelRmsDb[channel];
    let loudest: [string, number] | null = null;
    for (const [c, db] of Object.entries(s.channelRmsDb)) if (c !== channel && (!loudest || db > loudest[1])) loudest = [c, db];
    const isDead = this.dead.has(channel);
    let margin: number | null = ownDb === undefined || !loudest || isDead ? null : ownDb - loudest[1];

    if (margin !== null && margin <= -BLEED_DB) {
      return { decision: { participantKey: owner, confidence: 0, pending: false, signals, drop: 'bleed' }, notices };
    }

    if (isDead) {
      // Falls back to voice alone until the channel recovers.
      const pick = top ? top[0] : owner;
      const fusedDead = fuse({ channelMarginDb: null, voiceMatch: top ? top[1] : null, diarizerAgrees: null, overlap: s.overlap });
      return { decision: this.finish(pick, fusedDead, signals), notices };
    }

    let candidate = owner;
    // All-zero scores are no evidence either way.
    let diarizerAgrees: boolean | null = top && top[1] > 0 ? top[0] === owner : null;
    if (margin !== null && loudest && Math.abs(margin) <= BLEED_DB) {
      const other = this.owners[loudest[0]];
      if (other !== undefined && other !== owner && (s.voice[other] ?? 0) - (s.voice[owner] ?? 0) >= VOICE_LEAD) {
        candidate = other;
        margin = null;
        diarizerAgrees = null;
      }
    }

    this.trackMismatch(channel, owner, top, notices);

    const fused = fuse({ channelMarginDb: margin, voiceMatch: s.voice[candidate] ?? null, diarizerAgrees, overlap: s.overlap });
    if (candidate === owner) {
      // The margin says whose mic, not who spoke: an unmiked moderator can be loud on a debater's mic.
      const voiced = Object.keys(s.voice).length > 0;
      if (voiced && (!top || top[0] !== owner || top[1] < OWNER_VOICE)) return { decision: this.hold(owner, fused, top, signals), notices };
      if (!voiced && this.unmiked) return { decision: this.hold(owner, fused, null, signals), notices };
    }
    return { decision: this.finish(candidate, fused, signals), notices };
  }

  /** Called once per second with the current per-channel speech activity. */
  tick(nowMs: number, active: Record<string, boolean>): Notice[] {
    const notices: Notice[] = [];
    for (const [c, on] of Object.entries(active)) {
      if (!this.firstSeen.has(c)) this.firstSeen.set(c, nowMs);
      if (on) this.lastActive.set(c, nowMs);
      if (on && this.dead.has(c) && this.owners[c] !== undefined) {
        this.dead.delete(c);
        notices.push({ kind: 'channel_recovered', channel: c, participantKey: this.owners[c] });
      }
    }
    for (const c of Object.keys(this.owners)) {
      if (this.dead.has(c) || !this.firstSeen.has(c)) continue;
      const since = this.lastActive.get(c) ?? this.firstSeen.get(c)!;
      if (nowMs - since < DEAD_MS) continue;
      const othersSpoke = Object.keys(this.owners).some((o) => o !== c && (this.lastActive.get(o) ?? -Infinity) > since);
      if (!othersSpoke) continue;
      this.dead.add(c);
      notices.push({ kind: 'dead_channel', channel: c, participantKey: this.owners[c] });
    }
    return notices;
  }

  /** The host confirmed the two channels are crossed: exchange their owners. */
  applySwap(a: string, b: string): void {
    const oa = this.owners[a];
    const ob = this.owners[b];
    if (oa === undefined || ob === undefined) return;
    this.owners[a] = ob;
    this.owners[b] = oa;
    this.mismatch.delete(a);
    this.mismatch.delete(b);
  }

  private hold(owner: string, fused: number, top: [string, number] | null, signals: Decision['signals']): Decision {
    const confidence = Math.min(fused, HELD_MAX);
    const candidates: Record<string, number> = { [owner]: confidence };
    if (top && top[0] !== owner && top[1] > 0) candidates[top[0]] = top[1];
    return { participantKey: 'UNK', candidate: owner, candidates, confidence, pending: true, signals };
  }

  private finish(key: string, confidence: number, signals: Decision['signals']): Decision {
    if (confidence < AUTO_THRESHOLD) return { participantKey: 'UNK', candidate: key, confidence, pending: true, signals };
    return { participantKey: key, confidence, pending: false, signals };
  }

  /** Lines with no voice data (skipped at clear margins) are no evidence, so they leave the streak alone. */
  private trackMismatch(channel: string, owner: string, top: [string, number] | null, notices: Notice[]): void {
    if (!top) return;
    if (top[0] === owner || top[1] < SWAP_VOICE) {
      this.mismatch.set(channel, 0);
      return;
    }
    const n = (this.mismatch.get(channel) ?? 0) + 1;
    if (n >= SWAP_STREAK) {
      notices.push({ kind: 'swap_suggested', channel, participantKey: top[0] });
      this.mismatch.set(channel, 0);
    } else this.mismatch.set(channel, n);
  }
}
