/** Entity schemas from docs/ONTOLOGY.md §2–§4. */
import { z } from 'zod';
import {
  ArgumentScheme,
  Attitude,
  EpistemicBasis,
  HigherGroundConstruction,
  ItemStatus,
  PropositionType,
  Quantifier,
  QuestionStatus,
  RelationType,
  SettlingEvidence,
  SpeechAct,
  StanceSource,
  Strength,
  Stratum,
} from './enums';

export const Id = z.string().min(1);
export const ParticipantKey = z.string().min(1).describe("Short key, e.g. 'A', 'B', 'MOD', 'AUD'");

export const Word = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});

export const AttributionSignals = z.object({
  channel: z.string().optional(),
  diarLabel: z.string().optional(),
  voiceprint: z.record(z.string(), z.number()).optional(),
  zoomParticipant: z.string().optional(),
});

/** §2.1 */
export const Utterance = z.object({
  id: Id,
  participantKey: ParticipantKey,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  words: z.array(Word).default([]),
  attribution: z.object({
    confidence: z.number().min(0).max(1),
    signals: AttributionSignals.default({}),
    confirmedBy: z.enum(['auto', 'operator', 'fixture']),
  }),
  overlapsWith: z.array(Id).default([]),
});
export type Utterance = z.infer<typeof Utterance>;

/** A character range inside one utterance's text. */
export const Span = z.object({
  utteranceId: Id,
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().positive(),
  /** Exact text of the range; validators check it matches the utterance. */
  quote: z.string().min(1),
});
export type Span = z.infer<typeof Span>;

/** §2.2 */
export const Adu = z.object({
  id: Id,
  speakerKey: ParticipantKey,
  spans: z.array(Span).min(1),
  speechAct: SpeechAct,
  addressedTo: z.union([ParticipantKey, z.literal('audience'), z.literal('none')]).default('none'),
});
export type Adu = z.infer<typeof Adu>;

/** §2.3 */
export const Proposition = z.object({
  id: Id,
  canonical: z.string().min(3),
  type: PropositionType,
  stratum: Stratum,
  scope: z
    .object({
      quantifier: Quantifier.default('generic'),
      domain: z.string().optional(),
      timeHorizon: z.string().optional(),
    })
    .default({ quantifier: 'generic' }),
  conditions: z.array(z.string()).default([]),
  quantities: z.array(z.object({ value: z.string(), unit: z.string().optional() })).default([]),
  forecast: z.object({ resolution: z.string(), horizon: z.string().optional() }).optional(),
  aboutConcepts: z.array(Id).default([]),
  status: ItemStatus.default('live_provisional'),
});
export type Proposition = z.infer<typeof Proposition>;

/** §2.4 */
export const Stance = z.object({
  id: Id,
  participantKey: ParticipantKey,
  propositionId: Id,
  atMs: z.number().int().nonnegative(),
  viaAduId: Id.optional(),
  attitude: Attitude,
  strength: Strength,
  /** Only when the speaker states a probability. Never inferred (§2.4). */
  credence: z.number().min(0).max(1).optional(),
  source: StanceSource,
});
export type Stance = z.infer<typeof Stance>;

/** §2.6 */
export const Basis = z.object({
  id: Id,
  aduId: Id,
  basis: EpistemicBasis,
  stated: z.boolean(),
  sourceId: Id.optional(),
});

export const Source = z.object({
  id: Id,
  citation: z.object({
    title: z.string().optional(),
    author: z.string().optional(),
    organization: z.string().optional(),
    year: z.string().optional(),
    asSpoken: z.string(),
  }),
  checkable: z.literal(true),
  verified: z.literal(false),
});

/** §3 */
export const Relation = z.object({
  id: Id,
  type: RelationType,
  fromId: Id,
  toId: Id,
  scheme: ArgumentScheme.optional(),
  premises: z.array(Id).optional(),
  linked: z.boolean().optional(),
  rationale: z.string().optional(),
  inferred: z.boolean().default(false),
  status: ItemStatus.default('live_provisional'),
});
export type Relation = z.infer<typeof Relation>;

/** §2.8 */
export const Presupposition = z.object({
  id: Id,
  propositionId: Id.describe('The presupposed proposition'),
  forPropositionId: Id,
  necessity: z.object({ passes: z.boolean(), reason: z.string() }),
  status: ItemStatus.default('live_provisional'),
});

/** §2.9 */
export const Concept = z.object({ id: Id, term: z.string() });
export const Sense = z.object({
  id: Id,
  conceptId: Id,
  participantKey: ParticipantKey,
  gloss: z.string(),
  spans: z.array(Span).min(1),
});
export const Drift = z.object({
  id: Id,
  conceptId: Id,
  senseIds: z.array(Id).min(2),
  /** Drift requires at least one proposition whose truth value the difference changes (§2.9). */
  mattersFor: z.array(Id).min(1),
  status: ItemStatus.default('live_provisional'),
});

/** §4.5 */
export const Question = z.object({
  id: Id,
  askerKey: ParticipantKey,
  addresseeKey: z.union([ParticipantKey, z.literal('audience'), z.literal('none')]),
  aduId: Id,
  propositionId: Id.optional(),
  status: QuestionStatus,
  answerAduId: Id.optional(),
});

/** §4.6 */
export const Update = z.object({
  id: Id,
  participantKey: ParticipantKey,
  propositionId: Id,
  before: Stance.pick({ attitude: true, strength: true, credence: true }),
  after: Stance.pick({ attitude: true, strength: true, credence: true }),
  atMs: z.number().int().nonnegative(),
  triggerAduId: Id.optional(),
});

/** §4.2 */
export const Crux = z.object({
  id: Id,
  propositionId: Id,
  forDisagreements: z.array(Id).min(1),
  score: z.number(),
  updateConditions: z.record(ParticipantKey, z.string()),
  settlingEvidence: SettlingEvidence,
  valuesCrux: z.boolean(),
  status: ItemStatus.default('live_provisional'),
});

/** §4.4 */
export const HigherGround = z.object({
  id: Id,
  text: z.string().min(3),
  construction: HigherGroundConstruction,
  /** participantKey → proposition ids from that participant's commitment store it relies on */
  derivation: z.record(ParticipantKey, z.array(Id).min(1)),
  costs: z.record(ParticipantKey, z.string()),
  reliesOnInferred: z.boolean(),
  status: ItemStatus.default('live_provisional'),
});

/** §4.7 */
export const SteelmanRecord = z.object({
  id: Id,
  byKey: ParticipantKey,
  ofKey: ParticipantKey,
  aduId: Id,
  captured: z.array(Id),
  missed: z.array(Id),
  distorted: z.array(z.object({ propositionId: Id, how: z.string() })),
  added: z.array(z.string()),
  confirmed: z.boolean().optional(),
});

/** Facilitator prompt (PRD F15): a question, never a verdict. */
export const FacilitatorPrompt = z.object({
  id: Id,
  text: z.string().min(3),
  rationale: z.string(),
  targets: z.array(Id),
  kind: z.enum(['critical_question', 'crux_probe', 'drift_check', 'synthesis_test', 'inconsistency', 'open_question']),
  status: ItemStatus.default('live_provisional'),
});
