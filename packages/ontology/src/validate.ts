/**
 * Deterministic faithfulness validators (ARCHITECTURE §3.3, ONTOLOGY §8).
 * They run on every L1 proposal before the critic. A failure blocks approval
 * unless the operator overrides with a logged reason.
 */
import type { Adu, Proposition, Span, Stance, Utterance } from './entities';
import { NON_ATTRIBUTABLE_ACTS, NON_COMMITTING_ACTS, STRENGTH_RANK, type Quantifier, type Strength } from './enums';
import { HEDGE_NEUTRAL_PHRASES, HEDGES, QUANTIFIER_NEUTRAL_PHRASES, QUANTIFIER_WIDTH, QUANTIFIER_WORDS } from './lexicons';

export type ValidationCode =
  | 'span_missing_utterance'
  | 'span_out_of_range'
  | 'span_quote_mismatch'
  | 'new_number'
  | 'new_entity'
  | 'hedge_inflated'
  | 'scope_widened'
  | 'non_attributable_stance'
  | 'non_committing_stance'
  | 'rhetorical_overcommitted'
  | 'attribution_pending';

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  detail?: Record<string, unknown>;
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

/** Span exists, is in range, and its quote matches the utterance text exactly (§8.1). */
export function validateSpan(span: Span, utterances: ReadonlyMap<string, Utterance>): ValidationIssue[] {
  const u = utterances.get(span.utteranceId);
  if (!u) return [{ code: 'span_missing_utterance', message: `No utterance ${span.utteranceId}` }];
  if (span.charEnd > u.text.length || span.charStart >= span.charEnd) {
    return [{ code: 'span_out_of_range', message: `Range ${span.charStart}-${span.charEnd} outside utterance (len ${u.text.length})` }];
  }
  const actual = u.text.slice(span.charStart, span.charEnd);
  if (actual !== span.quote) {
    return [{ code: 'span_quote_mismatch', message: 'Quoted text does not match the utterance', detail: { expected: actual, got: span.quote } }];
  }
  return [];
}

// "one" is left out: as a pronoun or determiner ("one pole", "which side one takes") it
// produced only false positives (evals/results.md 2026-09-28). Digits still catch "1".
const NUMBER_RE = /\b\d+(?:[.,]\d+)?%?|\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty|hundred|thousand|million|billion|percent)\b/gi;
/** Capitalized tokens not at sentence start: a cheap proper-noun proxy. */
const ENTITY_RE = /(?<![.!?]\s|^)\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g;

/**
 * Numbers and named entities in the canonical text must appear in the spans or
 * in explicitly resolved antecedents (§8.2).
 */
export function validateNoNewContent(canonical: string, sourceTexts: string[]): ValidationIssue[] {
  const source = norm(sourceTexts.join(' '));
  const issues: ValidationIssue[] = [];
  for (const m of canonical.match(NUMBER_RE) ?? []) {
    if (!source.includes(norm(m))) issues.push({ code: 'new_number', message: `"${m}" not found in source spans` });
  }
  for (const m of canonical.match(ENTITY_RE) ?? []) {
    if (!source.includes(norm(m))) issues.push({ code: 'new_entity', message: `"${m}" not found in source spans` });
  }
  return issues;
}

const phraseRe = (phrase: string) => new RegExp(`(^|[^a-z'])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z']|$)`, 'g');

function containsPhrase(text: string, phrase: string): boolean {
  return phraseRe(phrase).test(text);
}

/** Blank out phrases that look like hedges or quantifiers but aren't (see lexicons). */
function stripPhrases(text: string, phrases: ReadonlyArray<string>): string {
  return phrases.reduce((t, p) => t.replace(phraseRe(p), '$1 '), text);
}

/** The strongest strength the span's hedges allow, or 'certain' if unhedged. */
export function maxStrengthForSpan(spanText: string): Strength {
  const t = stripPhrases(norm(spanText), HEDGE_NEUTRAL_PHRASES);
  let max: Strength = 'certain';
  for (const [phrase, cap] of HEDGES) {
    if (containsPhrase(t, phrase) && STRENGTH_RANK[cap] < STRENGTH_RANK[max]) max = cap;
  }
  return max;
}

/** Stance strength may not exceed what the span's hedges permit (§8.3). */
export function validateHedge(spanText: string, strength: Strength): ValidationIssue[] {
  const cap = maxStrengthForSpan(spanText);
  if (STRENGTH_RANK[strength] > STRENGTH_RANK[cap]) {
    return [{ code: 'hedge_inflated', message: `Strength "${strength}" exceeds hedge cap "${cap}"`, detail: { cap } }];
  }
  return [];
}

/** The narrowest quantifier word in the span; null when none appears. */
export function narrowestQuantifier(spanText: string): Quantifier | null {
  const t = stripPhrases(norm(spanText), QUANTIFIER_NEUTRAL_PHRASES);
  let found: Quantifier | null = null;
  for (const [word, q] of QUANTIFIER_WORDS) {
    if (containsPhrase(t, word) && (found === null || QUANTIFIER_WIDTH[q] < QUANTIFIER_WIDTH[found])) found = q;
  }
  return found;
}

/** A canonical quantifier may not be wider than the span's (§8.4). */
export function validateScope(spanText: string, quantifier: Quantifier): ValidationIssue[] {
  const spanQ = narrowestQuantifier(spanText);
  if (spanQ === null || spanQ === 'none') return [];
  if (QUANTIFIER_WIDTH[quantifier] > QUANTIFIER_WIDTH[spanQ]) {
    return [{ code: 'scope_widened', message: `Quantifier "${quantifier}" is wider than the span's "${spanQ}"` }];
  }
  return [];
}

/** attribute / steelman_report / nonliteral ADUs never produce stances for the speaker (§8.5). */
export function validateSpeechActStance(adu: Adu, stance: Stance): ValidationIssue[] {
  if (stance.participantKey === adu.speakerKey && NON_ATTRIBUTABLE_ACTS.has(adu.speechAct) && stance.source !== 'inferred') {
    return [{ code: 'non_attributable_stance', message: `A "${adu.speechAct}" act cannot commit ${adu.speakerKey} to a proposition` }];
  }
  return [];
}

/** question / challenge / meta ADUs don't change the speaker's commitment store (§2.2). */
export function validateCommittingAct(adu: Adu, stance: Stance): ValidationIssue[] {
  if (stance.participantKey === adu.speakerKey && NON_COMMITTING_ACTS.has(adu.speechAct) && stance.source !== 'inferred') {
    return [{ code: 'non_committing_stance', message: `A "${adu.speechAct}" act does not change ${adu.speakerKey}'s commitments` }];
  }
  return [];
}

/** A rhetorical question commits only to its implied statement: implied_by_act, at most leaning (§2.2). */
export function validateRhetorical(adu: Adu, stance: Stance): ValidationIssue[] {
  if (adu.speechAct !== 'rhetorical_question' || stance.participantKey !== adu.speakerKey) return [];
  if (stance.source !== 'implied_by_act' || STRENGTH_RANK[stance.strength] > STRENGTH_RANK.leaning) {
    return [{ code: 'rhetorical_overcommitted', message: `Implied statement must be implied_by_act at ≤ leaning (got ${stance.source}/${stance.strength})` }];
  }
  return [];
}

/** Checks on a stance alone: used when it attaches to an existing proposition from the index. */
export function validateStance(adu: Adu, stance: Stance): ValidationIssue[] {
  const spanText = adu.spans.map((s) => s.quote).join(' … ');
  return [
    ...validateHedge(spanText, stance.strength),
    ...validateSpeechActStance(adu, stance),
    ...validateCommittingAct(adu, stance),
    ...validateRhetorical(adu, stance),
  ];
}

/** Items from utterances whose attribution isn't confirmed are held (ARCHITECTURE §2.1). */
export function validateAttribution(spans: Span[], utterances: ReadonlyMap<string, Utterance>, threshold = 0.85): ValidationIssue[] {
  for (const s of spans) {
    const u = utterances.get(s.utteranceId);
    if (u && u.attribution.confirmedBy === 'auto' && u.attribution.confidence < threshold) {
      return [{ code: 'attribution_pending', message: `Utterance ${u.id} attribution ${u.attribution.confidence.toFixed(2)} < ${threshold}` }];
    }
  }
  return [];
}

/** Run every check for one proposed (ADU, proposition, stance) triple. */
export function validateProposal(args: {
  adu: Adu;
  proposition: Proposition;
  stance?: Stance;
  utterances: ReadonlyMap<string, Utterance>;
  resolvedAntecedents?: string[];
}): ValidationIssue[] {
  const { adu, proposition, stance, utterances } = args;
  const issues: ValidationIssue[] = [];
  for (const s of adu.spans) issues.push(...validateSpan(s, utterances));
  const spanText = adu.spans.map((s) => s.quote).join(' … ');
  issues.push(...validateNoNewContent(proposition.canonical, [spanText, ...(args.resolvedAntecedents ?? [])]));
  issues.push(...validateScope(spanText, proposition.scope.quantifier));
  if (stance) issues.push(...validateStance(adu, stance));
  issues.push(...validateAttribution(adu.spans, utterances));
  return issues;
}
