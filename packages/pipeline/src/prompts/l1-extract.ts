/**
 * L1 segment & extract (ARCHITECTURE §3.1, ONTOLOGY §2–§3, §8).
 * The frozen instructions are the cached prefix: never interpolate per-call data here.
 */
import { z } from 'zod';
import {
  ArgumentScheme,
  Attitude,
  EpistemicBasis,
  PropositionType,
  Quantifier,
  SpeechAct,
  Strength,
  Stratum,
} from '@adl/ontology';

export const L1_PROMPT_VERSION = 'l1-extract-v0.3';

export const L1Output = z.object({
  adus: z.array(
    z.object({
      ref: z.string().describe('Local ref like "d1"'),
      quotes: z.array(z.string()).min(1).describe('Exact verbatim substrings of the turn text, copied character-for-character'),
      speechAct: SpeechAct,
      addressedTo: z.string().describe("Participant key, 'audience', or 'none'"),
    }),
  ),
  propositions: z.array(
    z.object({
      ref: z.string().describe('Local ref like "p1"'),
      sameAs: z.string().nullable().describe('Existing proposition id from the index if this is the same content (same truth conditions, same scope, polarity-normalized); else null'),
      canonical: z.string().describe('One neutral declarative sentence in POSITIVE form; no hedges; no content absent from the quotes'),
      type: PropositionType,
      stratum: Stratum,
      quantifier: Quantifier,
      domain: z.string().nullable(),
      timeHorizon: z.string().nullable(),
      conditions: z.array(z.string()),
    }),
  ),
  stances: z.array(
    z.object({
      aduRef: z.string(),
      propositionRef: z.string().describe('Local ref or existing id'),
      participantKey: z.string(),
      attitude: Attitude,
      strength: Strength,
      credence: z.number().min(0).max(1).nullable().describe('ONLY if the speaker stated a probability; else null'),
    }),
  ),
  relations: z.array(
    z.object({
      type: z.enum(['supports', 'rebuts', 'undercuts', 'undermines', 'qualifies', 'concedes', 'agrees', 'exemplifies', 'answers']),
      fromRef: z.string(),
      toRef: z.string().describe('Local ref or existing id'),
      scheme: ArgumentScheme.nullable(),
      rationale: z.string(),
    }),
  ),
  bases: z.array(z.object({ aduRef: z.string(), basis: EpistemicBasis, stated: z.boolean() })),
  questions: z.array(z.object({ aduRef: z.string(), addresseeKey: z.string(), propositionRef: z.string().nullable() })),
});
export type L1Output = z.infer<typeof L1Output>;

export const L1_INSTRUCTIONS = `You extract the argumentative structure of one turn in a live, moderated debate. Your output feeds a map that an expert moderator and a live audience will read. Fidelity is the only goal. When in doubt, leave it out.

DEFINITIONS (binding)
- ADU: the smallest span performing one argumentative act. Quote it exactly, character for character, from the turn text. Several quotes are allowed if the speaker resumes a thought after an interruption.
- Speech acts: assert, concede, retract, question, answer, hypothesize ("suppose…"), steelman_report (stating the OTHER side's view as they would), attribute (reporting what someone else holds without adopting it), challenge (demanding a reason from the other side), commit_conditional ("if X, I'd agree"), meta (about the debate), rhetorical_question (a question whose point is a statement), nonliteral (irony, jokes, sarcasm). For a rhetorical_question, quote the question as spoken and give the IMPLIED statement as the proposition ("Why wait decades to see it?" → "People need not wait decades to see it."), with strength at most leaning. Use it only when the implied statement is unmistakable; otherwise it is a question or nonliteral. A hedged claim ("I have a feeling that…", "I worry that…") is an assert with a hedge, not a challenge. When the speaker cites an authority and explicitly adopts the view to make their own point ("as X showed, …", "X found that …, so …"), it is an assert; use attribute only when they report a view without adopting it.
- Proposition: speaker-independent content in one neutral declarative sentence. Speaker-independent means any participant could hold a stance on the same sentence: name people by their display name from PARTICIPANTS; never write "the speaker", "the listener", "I", "you" or "we" for a participant.
- Polarity: only when the speaker NEGATES a claim, store the positive form and put the negation in the stance ("Labs should not be licensed" → proposition "Labs should be licensed", attitude "rejects"). When the speaker states something positively, the proposition is what they said, with attitude "accepts". Never construct a contrary claim for the speaker to reject.
- Stance: the SPEAKER's attitude toward a proposition, with strength taken only from explicit hedges: "maybe/might/not sure" → tentative; "I think/probably/likely/I feel" → leaning; unhedged assertion → confident; certain ONLY with an explicit certainty marker ("certainly", "definitely", "no doubt", "100%"). "Always", "never" and "all" are scope, not certainty.
- Only assert, concede, answer, commit_conditional, retract and rhetorical_question (implied statement, at most leaning) produce stances for the speaker. question, challenge, meta, hypothesize, attribute, steelman_report and nonliteral produce none.
- Credence: only when the speaker states a probability ("70%", "one in ten"). Otherwise null.

RULES (violations make the output unusable)
1. Never assign content from steelman_report, attribute or nonliteral acts to the speaker. Such ADUs produce no stance for the speaker.
2. hypothesize content is not the speaker's commitment. Produce no "accepts" stance for it.
3. Canonical sentences add nothing: no names, numbers, dates, causes or domains that aren't in the quotes or the provided context.
4. Never widen scope. "Some labs" never becomes "labs". A report about particular people or cases (a story, "my clients found…") stays about them; it is not a general claim. Keep time frames, conditions, comparatives ("less likely" is not "unlikely") and modals.
5. Keep loaded wording out of canonical text. The quotes preserve the speaker's words.
6. Reuse an existing proposition id (sameAs) ONLY when truth conditions and scope are identical after polarity normalization.
7. Relations only when the speaker makes the connection, or it is unmistakable from adjacent sentences. Otherwise omit. Relations are between propositions, independent of who holds them: "X supports Y" means X being true makes Y more likely true. Evidence a speaker gives against a proposition they reject is rebuts or undermines, never supports.
8. One claim per proposition. Split conjunctions ("A, and B") into separate propositions unless the speaker presents them as a package.
9. Epistemic bases: mark stated=true only when the speaker indicates how they know ("studies show", "I worked on", "historically"). Otherwise stated=false, and only if clearly implied.
10. Filler, greetings, logistics and sponsor reads produce nothing.
11. Prefer fewer, correct items over many plausible ones.

TYPES: empirical, causal, predictive, counterfactual, normative, prescriptive, definitional, conceptual, modal, meta.
STRATA: praxis (what to do), empirical (what is / will be), axiology (what matters), epistemology (how we know), ontology (what exists).

Return only the JSON object required by the schema.`;

export function buildL1Input(args: {
  participants: { key: string; displayName: string }[];
  round: string | null;
  recentTurns: { participantKey: string; text: string }[];
  turn: { participantKey: string; text: string };
}): string {
  const who = args.participants.map((p) => `${p.key} = ${p.displayName}`).join('; ');
  const recent = args.recentTurns.map((t) => `[${t.participantKey}] ${t.text}`).join('\n');
  return `PARTICIPANTS: ${who}
ROUND: ${args.round ?? 'unspecified'}

RECENT CONTEXT (do not extract from this; use it only to resolve references):
${recent || '(none)'}

TURN TO EXTRACT — speaker ${args.turn.participantKey}:
"""
${args.turn.text}
"""`;
}

/** Append-only session context: the proposition index grows, never rewrites. */
export function buildSessionContext(index: { id: string; canonical: string }[]): string {
  if (index.length === 0) return 'PROPOSITION INDEX: (empty)';
  return `PROPOSITION INDEX (existing ids you may reference with sameAs / toRef):\n${index.map((p) => `${p.id}: ${p.canonical}`).join('\n')}`;
}
