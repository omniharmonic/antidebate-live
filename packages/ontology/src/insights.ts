/**
 * Insight card bodies (ONTOLOGY §4; UX §3). These are what `insight.proposed`
 * carries in `insight.body`, keyed by `insight.kind`. The L4 pass produces them;
 * code checks every reference against the commitment stores before emitting.
 * Every card points back to propositions, and propositions point back to spans.
 */
import { z } from 'zod';
import { Attitude, HigherGroundConstruction, SettlingEvidence, Strength } from './enums';

const Id = z.string().min(1);
const Key = z.string().min(1);

/** One side's position on a card's proposition, with the words that show it. */
export const SideStance = z.object({
  participantKey: Key,
  attitude: Attitude,
  strength: Strength,
  /** Verbatim quote from the stance's ADU (copied by code, never by the model). */
  quote: z.string(),
  stanceId: Id,
  /** For a clash-based crux: the side's own claim that attacks the crux proposition. */
  via: z.object({ propositionId: Id, statement: z.string(), relation: z.string() }).optional(),
});

/** §4.2 The crux now. `statement` is the proposition's canonical text. */
export const CruxCard = z.object({
  propositionId: Id,
  statement: z.string().min(3),
  sides: z.array(SideStance).min(1),
  /** participantKey → "would update toward the other side if …" (from their own words where possible). */
  updateConditions: z.record(Key, z.string()),
  settlingEvidence: SettlingEvidence,
  valuesCrux: z.boolean(),
  /** Disputed propositions downstream of this one (why it matters). */
  downstream: z.array(Id),
  score: z.number(),
  /** 'stated': both sides hold stances on this proposition. 'clash': it is attacked across sides by a stated relation. */
  basis: z.enum(['stated', 'clash']),
});
export type CruxCard = z.infer<typeof CruxCard>;

/** §4.4 A synthesis both could sign. Derivation ids are checked against each side's accepted commitments. */
export const HigherGroundCard = z.object({
  text: z.string().min(3),
  construction: HigherGroundConstruction,
  derivation: z.record(Key, z.array(Id).min(1)),
  costs: z.record(Key, z.string()),
  reliesOnInferred: z.boolean(),
});
export type HigherGroundCard = z.infer<typeof HigherGroundCard>;

/** PRD F15: a question for the facilitator to ask. Never a verdict. */
export const PromptCard = z.object({
  text: z.string().min(3),
  addresseeKey: z.union([Key, z.literal('both')]),
  kind: z.enum(['critical_question', 'crux_probe', 'drift_check', 'synthesis_test', 'inconsistency', 'open_question']),
  rationale: z.string(),
  targets: z.array(Id),
});
export type PromptCard = z.infer<typeof PromptCard>;

/** Where the two sides already agree (§4.3), split by kind. Computed in code, no model. */
export const SharedCard = z.object({
  ends: z.array(Id),
  facts: z.array(Id),
  framings: z.array(Id),
});
export type SharedCard = z.infer<typeof SharedCard>;

export const INSIGHT_BODIES = {
  crux: CruxCard,
  higher_ground: HigherGroundCard,
  prompt: PromptCard,
  shared: SharedCard,
} as const;
