import type { Setup } from './attributor';
import { AUTO_THRESHOLD } from './fusion';
import measured from './gate.json';

export type GateSetup = Setup | 'recording';
/** `insufficient`: wrong auto-accepts met the 2% ceiling, but on too small a sample to count as passed (P3-R7). */
export type Gate = { threshold: number; hostConfirmsAll: boolean; insufficient: boolean };
/**
 * What evals/attribution/report.ts writes to gate.json: one entry per setup it measured.
 * `measuredFrom: 'room-mix'`: the entry was measured on a room mix standing in for that setup's audio
 * (call, until call-like audio is measured), so it is not representative and counts as insufficient.
 */
export type GateTable = Partial<Record<GateSetup, Omit<Gate, 'insufficient'> & { insufficient?: boolean; measuredFrom?: string }>>;

const MEASURED: GateTable = measured;

/**
 * The auto-accept threshold for a setup, from the measured gate (evals/attribution/report.ts).
 * Never below 0.85; a setup the gate has not measured gets 0.85. When `hostConfirmsAll`, no
 * threshold kept wrong auto-accepts at or under 2%, and every line waits for the host.
 */
export function gateFor(setup: GateSetup, table: GateTable = MEASURED): Gate {
  const g = table[setup];
  if (!g) return { threshold: AUTO_THRESHOLD, hostConfirmsAll: false, insufficient: false };
  // Call measured on a room mix is not call audio (P3-R10): never a pass while that holds.
  const unrepresentative = setup === 'call' && g.measuredFrom === 'room-mix';
  return { threshold: Math.max(AUTO_THRESHOLD, g.threshold), hostConfirmsAll: g.hostConfirmsAll, insufficient: (g.insufficient ?? false) || unrepresentative };
}

/** What the setup screen says when the gate found no safe threshold for that setup. */
export const hostConfirmsNote = (setup: GateSetup, table: GateTable = MEASURED): string | null =>
  gateFor(setup, table).hostConfirmsAll ? 'In this setup, the host confirms who is speaking before a line enters the map.' : null;

/** A measured setup whose wrong auto-accepts stayed at or under 2% on a large enough sample. */
const passed = (setup: GateSetup, table: GateTable) => {
  if (table[setup] === undefined) return false;
  const g = gateFor(setup, table);
  return !g.hostConfirmsAll && !g.insufficient;
};

/**
 * Voice-only decisions (no channel margin) are capped just below the auto threshold in call and
 * room, so every such line is held for the host (AGENTS non-negotiable 6, ruling P2-R9).
 *
 * Rule: `capVoiceOnly` applies unless gate.json has an entry for that setup, measured by
 * evals/attribution/report.ts on the lab's runs, and it passed (hostConfirmsAll false, and not
 * `insufficient`: at least 200 auto-accepted lines and 20 minutes of them, ruling P3-R7). A missing
 * entry, a failed gate or too small a sample keeps the cap. Ruling P3-R6: the call/room entries count only once they
 * come from runs whose enrollment clips are disjoint from the scored audio. Ruling P3-R10: call stays
 * capped while its entry was measured on a room mix (`measuredFrom: 'room-mix'`).
 *
 * `tracks-voice`: a tracks line decided on voice alone because its mic is dead. The gate never
 * measures that case, so it is always capped (P3-R10).
 */
export const VOICE_ONLY_CAP = 0.84;
export type VoiceOnlySetup = Setup | 'tracks-voice';
export const VOICE_ONLY_CAPPED: readonly VoiceOnlySetup[] = ['call', 'room', 'tracks-voice'];

export const capVoiceOnly = (setup: VoiceOnlySetup, confidence: number, table: GateTable = MEASURED) =>
  VOICE_ONLY_CAPPED.includes(setup) && (setup === 'tracks-voice' || !passed(setup, table)) ? Math.min(confidence, VOICE_ONLY_CAP) : confidence;
