// Types shared by the live runner, its tests and the live screens.
import type { EventLog } from '@adl/engine';
import type { AsrClient } from '../asr/client';
import type { Anchor } from '../attribution/anchors';
import type { ChannelMap, Notice, Setup } from '../attribution/attributor';
import type { GateTable } from '../attribution/gate';

export type LiveSetup = { kind: Setup; channels: ChannelMap; participants: { key: string; displayName: string }[] };
export type LiveStatus = {
  audio: 'ok' | 'stopped';
  queue: number;
  lastLatencyMs: number | null;
  /** Latency of the last three utterances, oldest first. */
  recentLatencyMs: number[];
  notices: Notice[];
  unconfirmed: { utteranceId: string; text: string; candidates: Record<string, number> }[];
  /** Voices nobody enrolled, in the order they were heard, with the utterances to confirm together. */
  newVoices: { label: string; utteranceIds: string[] }[];
  /** Utterances that could not be transcribed or written. `retryAt(channel, startMs)` runs one again. */
  failed: { channel: string; startMs: number; endMs: number; reason: string }[];
};

/** The utterance id the runner writes for a cut: stable, so the view can find its audio. */
export const utteranceId = (channel: string, startMs: number) => `u${channel}-${startMs}`;

export type Job = { channel: string; u: { startMs: number; endMs: number; pcm: Float32Array }; rms: Record<string, number>; overlap: boolean; arrivedAt: number; endedAt?: number };

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
  /** The measured gate table (gate.json unless given); tests pin it. */
  gates?: GateTable;
};
