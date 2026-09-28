/**
 * Closed vocabularies from docs/ONTOLOGY.md. Changing any of these is an
 * ontology change: update the doc, the prompts, and the gold-set labels together.
 */
import { z } from 'zod';

/** §2.2 */
export const SpeechAct = z.enum([
  'assert',
  'concede',
  'retract',
  'question',
  'answer',
  'hypothesize',
  'steelman_report',
  'attribute',
  'challenge',
  'commit_conditional',
  'meta',
  'nonliteral',
]);
export type SpeechAct = z.infer<typeof SpeechAct>;

/** Speech acts that may change the speaker's commitment store (§2.2, §6). */
export const COMMITTING_ACTS = new Set<SpeechAct>([
  'assert',
  'concede',
  'retract',
  'commit_conditional',
  'answer',
]);
/** Speech acts whose content must never be assigned to the speaker (§8.5). */
export const NON_ATTRIBUTABLE_ACTS = new Set<SpeechAct>(['attribute', 'steelman_report', 'nonliteral']);

/** §2.3 */
export const PropositionType = z.enum([
  'empirical',
  'causal',
  'predictive',
  'counterfactual',
  'normative',
  'prescriptive',
  'definitional',
  'conceptual',
  'modal',
  'meta',
]);
export type PropositionType = z.infer<typeof PropositionType>;

/** §5 — ordered top (surface) to bottom (bedrock). */
export const Stratum = z.enum(['praxis', 'empirical', 'axiology', 'epistemology', 'ontology']);
export type Stratum = z.infer<typeof Stratum>;
export const STRATUM_DEPTH: Record<Stratum, number> = {
  praxis: 0,
  empirical: 1,
  axiology: 2,
  epistemology: 3,
  ontology: 4,
};

export const Quantifier = z.enum(['all', 'most', 'many', 'some', 'few', 'none', 'generic']);
export type Quantifier = z.infer<typeof Quantifier>;

/** §2.4 */
export const Attitude = z.enum(['accepts', 'rejects', 'suspends', 'accepts_conditionally', 'accepts_for_argument']);
export type Attitude = z.infer<typeof Attitude>;
/** Ordered weakest → strongest. */
export const Strength = z.enum(['tentative', 'leaning', 'confident', 'certain']);
export type Strength = z.infer<typeof Strength>;
export const STRENGTH_RANK: Record<Strength, number> = { tentative: 0, leaning: 1, confident: 2, certain: 3 };
export const StanceSource = z.enum(['stated', 'implied_by_act', 'inferred']);

/** §2.6 */
export const EpistemicBasis = z.enum([
  'empirical_study',
  'statistical',
  'expert_testimony',
  'institutional_record',
  'direct_experience',
  'anecdote',
  'historical_precedent',
  'analogy',
  'model_or_simulation',
  'deduction',
  'definition',
  'intuition_empirical',
  'moral_intuition',
  'consensus',
  'forecast_judgment',
]);
export type EpistemicBasis = z.infer<typeof EpistemicBasis>;

/** §2.7 */
export const ArgumentScheme = z.enum([
  'expert_opinion',
  'positive_consequences',
  'negative_consequences',
  'cause_to_effect',
  'sign',
  'analogy',
  'precedent',
  'practical_reasoning',
  'values',
  'slippery_slope',
  'verbal_classification',
  'popular_opinion',
  'best_explanation',
  'composition_division',
  'commitment',
]);
export type ArgumentScheme = z.infer<typeof ArgumentScheme>;

/** §3 */
export const RelationType = z.enum([
  'supports',
  'rebuts',
  'undercuts',
  'undermines',
  'qualifies',
  'concedes',
  'agrees',
  'equivalent',
  'presupposes',
  'defines',
  'exemplifies',
  'answers',
  'evades',
]);
export type RelationType = z.infer<typeof RelationType>;

/** §4.4 */
export const HigherGroundConstruction = z.enum([
  'domain_partition',
  'conditionalization',
  'value_lift',
  'incompletely_theorized_agreement',
  'sequencing',
  'pareto_move',
]);

/** §4.5 */
export const QuestionStatus = z.enum(['open', 'answered', 'partially_answered', 'deferred', 'not_answered']);

/** §7 — provenance lifecycle of every derived item. */
export const ItemStatus = z.enum([
  'live_provisional',
  'operator_approved',
  'released',
  'canonical',
  'participant_confirmed',
  'participant_contested',
  'rejected',
  'retracted',
]);
export type ItemStatus = z.infer<typeof ItemStatus>;

/** Crux settling-evidence kinds (§4.2). */
export const SettlingEvidence = z.enum(['empirical', 'forecast_resolution', 'value_clarification', 'definition']);
