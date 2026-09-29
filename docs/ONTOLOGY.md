# Topology Live — Argument & Epistemic Ontology

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28

This document defines what the system is allowed to say about a debate. Every extraction prompt, schema, validator, renderer and evaluation derives from it. If a concept isn't defined here, the system doesn't produce it.

It draws on:
- Toulmin (claim, data, warrant, backing, qualifier, rebuttal)
- Walton's argumentation schemes and critical questions
- ASPIC+ attack types (rebut, undercut, undermine)
- Hamblin/Walton–Krabbe dialogue games (commitment stores)
- Searle speech acts
- CFAR's double crux
- Sunstein's incompletely theorized agreements
- Dialectical Topology's worldview tree and Ontography's four worldview strata

---

## 1. Layers at a glance

```
MEDIA        Recording ── Utterance (speaker, words with timestamps)
               │
DISCOURSE    ADU (argumentative discourse unit) = span + speech act
               │ expresses
CONTENT      Proposition (speaker-independent, canonical, typed)
               │ held by                    │ grounded in             │ presupposes
STANCE       Stance(participant, prop, t)   EpistemicBasis             Presupposition ─▶ Stratum
               │                              │ cites
DIALECTIC    Relation(prop↔prop)            Source
               │
DERIVED      Disagreement · Crux · CommonGround · HigherGround · Drift · Question · Update · Steelman
```

## 2. Core entities

### 2.1 Utterance
A contiguous stretch of speech by one attributed participant.
- `id`, `participantId`, `startMs`, `endMs`
- `words[]` (text, startMs, endMs, confidence)
- `attribution` {`confidence` 0–1, `signals` {channel, diarLabel, voiceprint, zoomParticipant}, `confirmedBy`: auto | operator}
- `overlapsWith[]`

### 2.2 ADU — argumentative discourse unit
The smallest span that performs one argumentative act.
- `spans[]`: one or more {utteranceId, charStart, charEnd}. Discontinuous spans are allowed when a speaker completes a thought after an interruption.
- `speechAct` ∈ {`assert`, `concede`, `retract`, `question`, `answer`, `hypothesize` ("suppose…"), `steelman_report` (stating the other's view as the other would), `attribute` (stating what someone else holds, not as a steelman), `challenge` (demanding a reason), `commit_conditional` ("if X I'd agree"), `meta` (about the debate itself), `rhetorical_question` (a question whose point is a statement: "Why wait decades to see it?" conveys "People need not wait decades to see it"), `nonliteral` (irony, joke, sarcasm)}

**Rhetorical questions** (added 2026-09-28, Benjamin Life). The ADU keeps the question as spoken; the proposition is the *implied statement*. The speaker's stance on it has `source: implied_by_act` and strength at most `leaning`, and it is always displayed next to the original question so a reader can check the reading. If the implied statement isn't unmistakable, the ADU is `question` (a real question) or `nonliteral`, never a guess. Rhetorical questions don't enter the questions ledger.
- `addressedTo`: participantId | audience | none

Only `assert`, `concede`, `commit_conditional`, `hypothesize` (scoped), `answer` and `rhetorical_question` (implied, capped at `leaning`) change commitment stores (§6). `attribute` and `steelman_report` never assign the proposition to the speaker. That's the single most common extraction error in debate transcripts, so it's ruled out by construction.

### 2.3 Proposition
A speaker-independent, truth-apt (or norm-apt) content, stated canonically so that different speakers' stances can attach to the same object.

| Field | Values / rule |
|---|---|
| `canonical` | One declarative sentence. Neutral register. No hedges; hedges live in `modality`. Must be entailed by the span, plus resolved anaphora, under the faithfulness rules in §8. |
| `type` | `empirical` (what is the case) · `causal` (X brings about Y) · `predictive` (what will be) · `counterfactual` · `normative` (what is good or bad) · `prescriptive` (what should be done) · `definitional` (what a term means or covers) · `conceptual` (a relation between concepts) · `modal` (what is possible or necessary) · `meta` (about arguments or evidence) |
| `polarity` | The proposition is stored in positive form. Negation lives in stance (§2.4), so "AI labs should be licensed" and "AI labs should not be licensed" are one proposition with opposite stances. |
| `scope` | `quantifier` (all · most · many · some · few · none · generic), `domain` (e.g., "frontier labs in the US"), `timeHorizon` (e.g., "by 2030") |
| `conditions[]` | Antecedents under which it is asserted ("if compute keeps scaling…"). A conditional is its own proposition type-wrapped; see §2.5. |
| `quantities[]` | Numbers with units, as spoken ("10x", "within 3 years") |
| `forecast` | For predictive propositions: `resolution` (what would settle it), `horizon`. Credence lives on the stance. |
| `stratum` | `praxis` (policy, action) · `axiology` (values) · `epistemology` (how we know) · `ontology` (what exists) · `empirical` (world state). Used for vertical layout and worldview analysis. |
| `aboutConcepts[]` | Concept ids (§2.9) that the proposition leans on |

### 2.4 Stance
A participant's relation to a proposition at a moment in time. Stances are events, so their history is preserved.
- `participantId`, `propositionId`, `atMs`, `viaAduId`
- `attitude` ∈ {`accepts`, `rejects`, `suspends` (explicitly unsure), `accepts_conditionally`, `accepts_for_argument`}
- `strength` ∈ {`certain`, `confident`, `leaning`, `tentative`}, derived *only* from explicit hedges in the span (§8.3)
- `credence`: a number in 0–1, **only when the speaker states one** ("I'd put it at 70%"). Never inferred.
- `source`: `stated` | `implied_by_act` (e.g., concession) | `inferred` (from other commitments; shown as inferred and never used for scoring or ledgers)

### 2.5 Compound propositions
- **Conditional** `if P then Q`: a proposition with `antecedent` P and `consequent` Q. A stance on the conditional is not a stance on P or Q.
- **Conjunction**: split into parts unless the speaker explicitly treats it as a package.
- **Comparative** ("X is worse than Y"): the proposition has `comparands` [X, Y] and a `dimension`.

### 2.6 Epistemic basis
How the speaker claims to know it, as asserted or clearly implied in the span. Each assertion has zero or more bases. Each basis has `stated` or `inferred` status.

| Basis | Test |
|---|---|
| `empirical_study` | Cites research, data, measurement |
| `statistical` | Cites a rate, trend or distribution |
| `expert_testimony` | Appeals to a named or described authority |
| `institutional_record` | Law, policy text, official statistic |
| `direct_experience` | "I've seen / I worked on…" |
| `anecdote` | A single illustrative case |
| `historical_precedent` | "Last time X happened…" |
| `analogy` | Structural comparison to another domain |
| `model_or_simulation` | A formal or informal model, game-theoretic reasoning |
| `deduction` | Follows logically from stated premises |
| `definition` | True by meaning |
| `intuition_empirical` | "It seems obvious that…" about facts |
| `moral_intuition` | "It's just wrong that…" |
| `consensus` | "Most people in the field think…" |
| `forecast_judgment` | Judgmental prediction without a stated model |

A `Source` entity is created whenever a specific source is cited (title, author, organization, year, as spoken). It has `checkable: true` and `verified: false`. The system records citations; it doesn't verify them live.

### 2.7 Argumentation scheme (for `supports` relations)
From Walton's catalogue, restricted to the ones that recur in policy and values debate:
- expert opinion
- positive or negative consequences
- cause to effect
- sign
- analogy
- precedent
- practical reasoning (goal + means)
- values
- slippery slope
- verbal classification
- popular opinion
- best explanation (abduction)
- composition/division
- commitment

Each scheme carries its **critical questions**. Unanswered critical questions become **facilitator-prompt candidates** (e.g., for expert opinion: "Is the expert's field the relevant one?").

### 2.8 Presupposition and stratum
A proposition the assertion *requires* to be true to make sense or to have force, and which was not stated.
- Always `source: inferred`. Visually translucent. Never counted in stance, disagreement or ledger computations until a participant states it.
- Must pass the **necessity test**: "If this presupposition were false, would the assertion lose its truth or its force?" The critic pass enforces this.
- Placed on a stratum: presuppositions tend to sit deeper (axiology, epistemology, ontology) than the assertions they ground.
- Relation: `presupposes(assertion → presupposition)`.

### 2.9 Concept and sense
- `Concept`: a load-bearing term (e.g., "safety", "regulation", "alignment", "market").
- `Sense`: a participant's usage of a concept, with `gloss` and supporting spans.
- **Drift**: two participants' senses of one concept that differ in ways that change the truth value of propositions both engage with. Drift requires at least one proposition where the difference in sense matters. Otherwise it's a vocabulary note, not drift.

## 3. Relations (proposition ↔ proposition, or ADU ↔ ADU for dialogue relations)

| Relation | Meaning | Notes |
|---|---|---|
| `supports` | Premise(s) → conclusion | Carries `scheme`, `premises[]` (linked, all needed) vs convergent (each alone) |
| `rebuts` | Attacks the conclusion directly (argues ¬P) | Symmetric in effect, asymmetric in record |
| `undercuts` | Attacks the *inference* from premises to conclusion, not the premises or conclusion | Typically answers a critical question |
| `undermines` | Attacks a premise | |
| `qualifies` | Narrows scope, adds a condition, lowers strength | Most common "partial agreement" move |
| `concedes` | Accepts the other's proposition (stance change) | Creates an Update if it reverses a prior stance |
| `agrees` | Independently accepts the same proposition | Common ground candidate |
| `equivalent` | Two canonical propositions are the same content | Identity resolution; merges into one proposition |
| `presupposes` | See §2.8 | Inferred |
| `defines` | Fixes the sense of a concept | Feeds drift detection |
| `exemplifies` | Instance of a general claim | |
| `answers` | ADU(answer) → ADU(question) | Question ledger |
| `evades` | ADU after a question that doesn't address it | Only when the critic agrees and the question was direct; labeled "not answered" in any audience output, never "evaded" |

## 4. Derived structures

### 4.1 Disagreement
A disagreement exists on proposition P at time t when two participants hold opposing stances: accepts vs rejects, or accepts vs suspends with strength ≥ confident. Its **depth** is P's stratum. Its **kind** is P's type (empirical, predictive, normative…). "They disagree about a forecast" and "they disagree about a value" are different findings, and they're rendered differently.

### 4.2 Crux
Following double crux: a proposition C is a crux for a disagreement on P when, for each party, their stance on P depends on their stance on C, and they hold different stances on C (or differing credences on a predictive C).

Operationally, a crux candidate must have:
1. A support or presupposition path from C to P, or to P's negation, for **each** participant, in the stated graph or with at most one inferred link, marked as such.
2. A disagreement on C.
3. A **dependency score**: the number of other disagreements whose support paths pass through C, weighted by stratum depth.

Every crux card states:
- the proposition
- each side's stance on it, with spans
- "A would update toward B on P if…"
- "B would update toward A on P if…"
- the **type of evidence** that could settle it (empirical, forecast resolution, value clarification, definition)

A crux whose settling evidence is "value clarification" is labeled a **values crux**. Those are often irreducible, and are displayed as such.

### 4.3 Common ground
Propositions both participants accept (stated or conceded), with strength ≥ leaning. It's separated into **shared ends** (normative, prescriptive), **shared facts** (empirical), and **shared framings** (definitional).

### 4.4 Higher ground (synthesis)
A proposition or action H that both participants could accept, **consistent with their current commitment stores**, and that integrates at least one element from each side's position. Every candidate carries:
- a `construction` (below)
- a `derivation` (the commitments of each participant it relies on)
- the `cost to each side` (what each would have to qualify, if anything)
- `status` ∈ {candidate, operator-approved, released, confirmed by both}

| Construction | Shape | Example pattern |
|---|---|---|
| `domain_partition` | Both are right about different domains, time frames or scales | "Understanding serves healing after harm; judgment serves prevention before it" (DT's temporal integration) |
| `conditionalization` | Replace the dispute over P with the shared conditional "if C then P" plus the crux C | Turns a stalemate into an agreed research question |
| `value_lift` | A higher value both endorse, under which both positions become means | Both want accountable power; they differ on which institution concentrates it less |
| `incompletely_theorized_agreement` | Agreement on an action for different reasons | Both support third-party audits, one as a step toward regulation, the other as an alternative to it |
| `sequencing` | Both proposals in an order both accept | "Transparency now; licensing if thresholds are crossed" |
| `pareto_move` | A modification that improves the position by each side's own lights | Each side's top concern is addressed without violating the other's top commitment |

A candidate that relies on inferred commitments is **held from audiences** until a participant states the relevant commitment or the operator overrides with a visible "inferred" label.

### 4.5 Questions ledger
Every `question` ADU → {asker, addressee, proposition in question, status ∈ open · answered · partially_answered · deferred · not_answered, answerAduId?}. Status changes are events.

### 4.6 Updates ledger
A stance change on the same proposition by the same participant: attitude change, strength change, or credence change. Each records its **trigger** (the ADU or evidence immediately preceding it, when identifiable). A `concede` speech act always produces an update entry.

### 4.7 Steelman record
A `steelman_report` ADU by A about B → mapped to B's commitment store as {captured[], missed[] (B's high-centrality commitments absent), distorted[] (strength, scope or sense changed), added[] (not in B's store)} + B's confirmation status.

## 5. Strata (vertical structure)

Top to bottom: **higher ground** (derived) → **praxis** (what to do) → **empirical / predictive** (what is, what will be) → **axiology** (what matters) → **epistemology** (how we know) → **ontology** (what exists). This follows DT's epistemological tree and Ontography's layers. The 3D and 2D layouts use strata as the vertical axis, so a disagreement's depth is literally visible.

## 6. Commitment stores (the dialogue game)

Each participant has a commitment store, the set of propositions they are on record as accepting. It changes only through `assert`, `concede`, `commit_conditional`, `answer` (when the answer asserts) and `retract`. The store is the ground truth for:
- disagreement
- common ground
- higher-ground consistency checks
- steelman comparison
- update detection

Inferred presuppositions never enter a store.

**Inconsistency flags:** when a participant's store contains P and ¬P (or propositions the critic judges jointly inconsistent), the operator gets a private flag. It's never shown to an audience automatically. The facilitator can choose to use it as a prompt ("Earlier you said…; how do those fit?").

## 7. Provenance and status (on every derived item)

`live_provisional` → `operator_approved` → `released` (shown to some audience level) → `canonical` (post-event pass) → `participant_confirmed` | `participant_contested`

Every item records the prompt version, model, pass, critic verdict, operator action and timestamps.

## 8. Faithfulness rules (enforced by validators and the critic)

8.1 **Span entailment.** The canonical proposition must be entailed by its spans plus resolved references. If the span says "might", the proposition can't be stated as the speaker's certain belief.
8.2 **No new content.** Named entities, numbers, time frames and causal claims in the canonical text must appear in the spans or in resolved antecedents. Validated automatically (entity/number diff), then by the critic.
8.3 **Hedge preservation.** Hedge markers in the span ("I think", "probably", "maybe", "I'm not sure", "arguably") must map to stance strength. There is a closed lexicon plus critic review.
8.4 **Scope preservation.** Quantifiers and domains may not be widened ("some labs" never becomes "labs").
8.5 **Attribution by speech act.** Content of `attribute` or `steelman_report` acts is never assigned to the speaker (§2.2).
8.6 **Irony, hypotheticals and rhetorical questions.** `nonliteral` and `hypothesize` content doesn't enter commitment stores. A `rhetorical_question` enters only as its implied statement, `implied_by_act`, strength ≤ `leaning`, shown with the question. If unsure, the ADU is flagged for the operator and not committed.
8.7 **Signability.** The critic asks: "Would the speaker sign this canonical sentence as a fair statement of what they asserted?" A fail blocks release.
8.8 **Minimal inference.** Inferred items (presuppositions, schemes, senses) are allowed only when they pass their necessity or fit tests. They are always marked inferred.
8.9 **Neutral register.** Canonical text avoids loaded paraphrase. The speaker's own loaded term is kept in quotes if it carries weight ("a 'cosmic conspiracy'").

## 9. Worked example (illustrative, hypothetical speakers)

> **A** (00:12:04): "I think if we don't get some kind of third-party auditing in the next two or three years, the labs will just grade their own homework, and that's how you get a disaster."

- ADU 1, `assert`. Proposition P1 (predictive/causal): "Absent third-party auditing within 2–3 years, frontier AI labs will evaluate their own systems." Stance A: accepts, strength `leaning` ("I think"). Epistemic basis: `forecast_judgment` (inferred).
- ADU 2, `assert`. Proposition P2 (causal): "Self-evaluation by AI labs increases the risk of a catastrophic outcome." Stance A: accepts, `leaning`. Relation P1 `supports` P2', where P2' = (prescriptive) "Third-party auditing of frontier AI labs should be established within 2–3 years". The scheme is negative consequences, and P2' is implied by the practical-reasoning frame, so it's marked inferred until A states it.
- Presupposition (inferred): "Lab self-evaluation is less reliable than independent evaluation." Stratum: epistemology. It passes the necessity test.
- The loaded term "grade their own homework" is kept as a quoted phrase in the span, not in the canonical text.

> **B** (00:12:31): "Look, audits I'm fine with. What I don't want is a licensing regime, because the agency that licenses becomes the chokepoint."

- ADU 3, `concede`/`agrees` on the auditing part of P2'. Stance B: accepts P2' (`confident`). → **Common ground** candidate on P2'. Because P2' was inferred for A, the common ground is held until A states P2' or the operator overrides with an "inferred" label.
- ADU 4, `assert`. P3 (prescriptive): "A licensing regime for frontier AI should not be established." Stored in positive form: "A licensing regime for frontier AI should be established", with stance B: rejects.
- ADU 5, `supports` P3 (causal) via P4: "A licensing agency becomes a point of concentrated control." Scheme: negative consequences. Presupposition (inferred): "Concentrated regulatory control is more dangerous than distributed private control." Stratum: axiology/ontology of institutions. **Crux candidate** if A's support for licensing rests on the opposite.
- **Higher-ground candidate** (`incompletely_theorized_agreement`): "Establish independent third-party auditing of frontier labs now." Derivation: A{P1, P2'}, B{ADU 3}. Cost: A defers licensing; B accepts a mandate for audits. Status: candidate, held until P2' is stated by A.
