/**
 * Round detection from moderator turns (PRD §7). Formats are data
 * (packages/core/src/formats.ts); the model only picks from the listed rounds,
 * and only when the moderator's words open it unmistakably. Works the same live
 * and in replay. The operator can always set the round by hand (console).
 */
import { z } from 'zod';
import { getFormat, type DomainEvent } from '@adl/core';
import { callStructured, type LlmCallLog } from '@adl/llm';
import type { Turn } from './turns';

export const ROUNDS_PROMPT_VERSION = 'round-detect-v0.1';

export const RoundOutput = z.object({
  opensRound: z.string().nullable().describe('Round id the moderator is opening in this turn, or null'),
  certain: z.boolean().describe('true only if the moderator explicitly opens or hands over to that round'),
  quote: z.string().describe('The moderator words that open it (verbatim), or empty'),
});
export type RoundOutput = z.infer<typeof RoundOutput>;

export const ROUNDS_INSTRUCTIONS = `You follow a moderated debate and track which round it is in. You get the format's rounds (id, name, what happens, typical moderator phrases), the current round, and one moderator turn.
Decide whether this moderator turn opens a new round: the moderator announces it, hands the floor for it ("Daniel, you have six minutes for your opening"), or clearly moves the debate into it.
- Only choose a round id from the list.
- Timekeeping, thanks, follow-up questions and summaries inside the current round open nothing: return null.
- certain=true only when the words make the transition unmistakable. Quote them exactly.
Return only the JSON object required by the schema.`;

export function buildRoundInput(formatId: string, currentRoundId: string | null, turnText: string): string {
  const f = getFormat(formatId);
  const rounds = f.rounds
    .map((r) => `- ${r.id}: ${r.name} (${f.phases.find((p) => p.id === r.phase)?.name ?? r.phase}; speakers: ${r.speakingOrder.join(', ') || 'none'}${r.optional ? '; optional' : ''}) — cues: ${r.cues.join(' / ') || 'none'}`)
    .join('\n');
  return `FORMAT: ${f.name}\nROUNDS:\n${rounds}\n\nCURRENT ROUND: ${currentRoundId ?? 'none yet'}\n\nMODERATOR TURN:\n"""\n${turnText}\n"""`;
}

/** round.ended + round.started when the moderator opens a different round. */
export function roundEvents(
  turn: Turn,
  out: RoundOutput,
  ctx: { sessionId: string; formatId: string; currentRoundId: string | null; wallTs: string },
): DomainEvent[] {
  const def = out.opensRound ? getFormat(ctx.formatId).rounds.find((r) => r.id === out.opensRound) : undefined;
  if (!def || !out.certain || def.id === ctx.currentRoundId) return [];
  const base = { sessionId: ctx.sessionId, actor: 'system' as const, mediaMs: turn.startMs, wallTs: ctx.wallTs, causedBy: [turn.turnId] };
  const events: DomainEvent[] = [];
  if (ctx.currentRoundId) events.push({ ...base, eventId: `${turn.turnId}:round-end`, type: 'round.ended', payload: { roundId: ctx.currentRoundId } });
  events.push({ ...base, eventId: `${turn.turnId}:round`, type: 'round.started', payload: { roundId: def.id, name: def.name, ...(def.plannedMs ? { plannedMs: def.plannedMs } : {}) } });
  return events;
}

export async function detectRound(
  turn: Turn,
  ctx: { sessionId: string; formatId: string; currentRoundId: string | null; wallTs: () => string },
): Promise<{ events: DomainEvent[]; log: LlmCallLog; error?: string }> {
  const result = await callStructured({
    pass: 'round_detect',
    promptVersion: ROUNDS_PROMPT_VERSION,
    instructions: ROUNDS_INSTRUCTIONS,
    input: buildRoundInput(ctx.formatId, ctx.currentRoundId, turn.text),
    schema: RoundOutput,
    sessionId: ctx.sessionId,
  });
  if (!result.ok) return { events: [], log: result.log, error: `${result.reason}: ${result.detail}` };
  return { events: roundEvents(turn, result.data, { ...ctx, wallTs: ctx.wallTs() }), log: result.log };
}
