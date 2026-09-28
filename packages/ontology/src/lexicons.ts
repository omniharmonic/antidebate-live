/**
 * Closed lexicons for the deterministic faithfulness validators (ONTOLOGY §8.3–8.4).
 * Lowercase; matched on word boundaries. Extend with gold-set evidence, not intuition.
 */
import type { Quantifier, Strength } from './enums';

/** Hedge phrase → the STRONGEST stance strength it permits. */
export const HEDGES: ReadonlyArray<[string, Strength]> = [
  ['i\'m not sure', 'tentative'],
  ['not sure', 'tentative'],
  ['i don\'t know', 'tentative'],
  ['maybe', 'tentative'],
  ['perhaps', 'tentative'],
  ['possibly', 'tentative'],
  ['might', 'tentative'],
  ['could be', 'tentative'],
  ['i wonder', 'tentative'],
  ['i suspect', 'leaning'],
  ['i think', 'leaning'],
  ['i believe', 'leaning'],
  ['i feel like', 'leaning'],
  ['probably', 'leaning'],
  ['likely', 'leaning'],
  ['arguably', 'leaning'],
  ['it seems', 'leaning'],
  ['my guess', 'leaning'],
  ['i\'m fairly confident', 'confident'],
  ['pretty sure', 'confident'],
  ['i\'m confident', 'confident'],
];

/** Quantifier words → the widest quantifier the canonical form may use. */
export const QUANTIFIER_WORDS: ReadonlyArray<[string, Quantifier]> = [
  ['every', 'all'],
  ['all', 'all'],
  ['always', 'all'],
  ['most', 'most'],
  ['usually', 'most'],
  ['many', 'many'],
  ['often', 'many'],
  ['some', 'some'],
  ['sometimes', 'some'],
  ['a few', 'few'],
  ['few', 'few'],
  ['rarely', 'few'],
  ['no', 'none'],
  ['never', 'none'],
  ['none', 'none'],
];

/** Ordered narrow → wide. A canonical quantifier may not be wider than the span's. */
export const QUANTIFIER_WIDTH: Record<Quantifier, number> = {
  none: 0,
  few: 1,
  some: 2,
  many: 3,
  most: 4,
  all: 5,
  generic: 5,
};
