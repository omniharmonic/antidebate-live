// Words and lists for the live screens: the status line, notices, the mic mapping check, and
// what a hydrated log says is still waiting for the host. Pure, so the copy is tested.
import type { DomainEvent } from '@adl/core';
import type { ChannelMap, Notice } from '../attribution/attributor';

export type NoticeContext = { channels: ChannelMap; names: Record<string, string> };
export type PendingLine = { utteranceId: string; text: string; candidates: Record<string, number> };

/** The channels a setup segments: each mapped mic in the tracks setup, else the one feed. */
export function listenChannels(setup: { kind: string; channels: ChannelMap }): string[] {
  return setup.kind === 'tracks' ? Object.keys(setup.channels).sort() : ['d0c0'];
}

/** Inputs are numbered in channel-id order (d0c0, d0c1, d1c0, …), from 1. */
export function inputNumber(channels: ChannelMap, channel: string): number {
  return Object.keys(channels).sort().indexOf(channel) + 1;
}

export function statusLine(inputs: number, latencyMs: number | null): string {
  const head = `Listening · ${inputs} ${inputs === 1 ? 'input' : 'inputs'}`;
  return latencyMs === null ? head : `${head} · transcript about ${(latencyMs / 1000).toFixed(1)} s behind`;
}

export type LivePhase = 'loading' | 'live' | 'ending' | 'ending-failed' | 'ended' | 'elsewhere';
export type LiveControl = 'resume-listening' | 'resume-audio' | 'pause' | 'resume' | 'end' | 'try-end-again';

/**
 * The buttons the live view offers. Once End has started, capture never comes back (the runner is
 * stopped), so a failed End offers only "Try ending again".
 */
export function liveControls(phase: LivePhase, capture: 'waiting' | 'on' | 'paused' | 'stopped'): LiveControl[] {
  if (phase === 'ending-failed') return ['try-end-again'];
  if (phase !== 'live') return [];
  const first: Record<typeof capture, LiveControl> = { waiting: 'resume-listening', on: 'pause', paused: 'resume', stopped: 'resume-audio' };
  return [first[capture], 'end'];
}

const SLOW_MS = 4_000;
const SLOW_STREAK = 3;

/** The warning when each of the last three utterances came through more than 4 s after it ended. */
export function latencyWarning(recentMs: number[]): string | null {
  const last = recentMs.slice(-SLOW_STREAK);
  if (last.length < SLOW_STREAK || !last.every((ms) => ms > SLOW_MS)) return null;
  return 'Transcription is running more than 4 seconds behind on this laptop. Close other apps, or switch to a faster laptop.';
}

/** The channel a participant is mapped to, if any. */
export function channelOf(channels: ChannelMap, key: string): string | undefined {
  return Object.keys(channels).find((c) => channels[c] === key);
}

export function noticeLine(n: Notice, { channels, names }: NoticeContext): string | null {
  const name = (k: string | undefined) => (k ? (names[k] ?? k) : 'someone');
  const input = n.channel ? inputNumber(channels, n.channel) : 0;
  switch (n.kind) {
    case 'dead_channel':
      return `Input ${input} (${name(n.participantKey)}) has been silent for a minute while others speak. ${name(n.participantKey)} will be identified by voice until it recovers.`;
    case 'channel_recovered':
      return `Input ${input} (${name(n.participantKey)}) is working again.`;
    case 'swap_suggested': {
      const other = n.participantKey ? channelOf(channels, n.participantKey) : undefined;
      const head = `Input ${input} sounds like ${name(n.participantKey)}.`;
      return other ? `${head} Swap inputs ${input} and ${inputNumber(channels, other)}?` : head;
    }
    case 'voice_match_unavailable':
      return 'Voice matching is not working. Unsure lines are held for you to confirm.';
    case 'new_voice':
      return null; // shown as a voice group with its own controls
  }
}

/** Notices still worth showing, with their index in the runner's list (stable: the list only grows). */
export function visibleNotices(notices: Notice[], dismissed: Set<number>): { index: number; notice: Notice }[] {
  return notices
    .map((notice, index) => ({ index, notice }))
    .filter(({ notice, index }) => {
      if (dismissed.has(index) || notice.kind === 'new_voice') return false;
      if (notice.kind === 'dead_channel') return !notices.some((m, j) => j > index && m.kind === 'channel_recovered' && m.channel === notice.channel);
      return true;
    });
}

/**
 * What choosing a device does in the mics setup: the first one is used; a device with problems is
 * replaced; otherwise devices are added until there is an input for every debater, then replaced.
 */
export function deviceAction(devices: { channels: number; problems: number }[], debaters: number): 'use' | 'add' | 'replace' {
  const last = devices.at(-1);
  if (!last) return 'use';
  if (last.problems > 0) return 'replace';
  return devices.reduce((n, d) => n + d.channels, 0) < debaters ? 'add' : 'replace';
}

/** Every debater is on exactly one input (others, such as the moderator, may have one too). */
export function mappingComplete(map: Record<string, string>, debaters: string[]): boolean {
  const used = Object.values(map).filter(Boolean);
  if (new Set(used).size !== used.length) return false;
  return debaters.every((k) => used.includes(k));
}

function scan(events: DomainEvent[]) {
  const finals = new Map<string, { key: string; text: string }>();
  const pending = new Map<string, Record<string, number>>();
  const confirmed = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'utterance.final') finals.set(e.payload.utterance.id, { key: e.payload.utterance.participantKey, text: e.payload.utterance.text });
    else if (e.type === 'attribution.pending') pending.set(e.payload.utteranceId, e.payload.candidates);
    else if (e.type === 'attribution.confirmed') confirmed.set(e.payload.utteranceId, e.payload.participantKey);
  }
  return { finals, pending, confirmed };
}

/** Lines held for the host (pending, never confirmed), for a page that reloaded mid-session. */
export function pendingFromLog(events: DomainEvent[]): PendingLine[] {
  const { finals, pending, confirmed } = scan(events);
  return [...pending].filter(([id]) => !confirmed.has(id) && finals.has(id)).map(([utteranceId, candidates]) => ({ utteranceId, text: finals.get(utteranceId)!.text, candidates }));
}

/** The last `limit` transcript lines with a speaker name; an unsure line shows its best guess. */
export function transcriptLines(events: DomainEvent[], names: Record<string, string>, limit: number): { id: string; speaker: string; text: string }[] {
  const { finals, pending, confirmed } = scan(events);
  const lines = [...finals].map(([id, f]) => {
    const key = confirmed.get(id) ?? (pending.has(id) ? undefined : f.key);
    if (key !== undefined && key !== 'UNK') return { id, speaker: names[key] ?? key, text: f.text };
    const guess = Object.entries(pending.get(id) ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { id, speaker: guess ? `Not sure (${names[guess] ?? guess}?)` : 'Not sure', text: f.text };
  });
  return lines.slice(-limit);
}
