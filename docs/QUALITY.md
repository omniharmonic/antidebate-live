# Topology Live — Quality & Evaluation

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28

The map's value depends entirely on trust. One misattributed quote, or one inflated hedge, in front of a moderator trained in game theory costs more than any feature adds. This document defines how quality is measured, gated and defended.

---

## 1. Quality model

Four layers, each with its own measurement:

| Layer | Question | Primary metrics |
|---|---|---|
| **Attribution** | Who said it? | Attribution accuracy, A↔B swap rate, hold rate |
| **Extraction** | What exactly did they assert, with what strength, scope and speech act? | Proposition precision/recall, faithfulness, hedge fidelity, scope fidelity, speech-act accuracy |
| **Structure** | How do assertions relate, and which are the same proposition? | Relation F1 by type, identity-resolution F1, presupposition necessity pass rate |
| **Insight** | Where is the crux, and what is the higher ground? | Crux agreement with experts, higher-ground signability, prompt usefulness |

## 2. Gold sets

| Set | Source | Size | Use |
|---|---|---|---|
| **G1 DT fixture** | Marcus × Demartini transcript (DT `data/bundle/transcript_diarized.json`), 105 min | 3 × 12-min segments fully annotated | Early prompt development; DT's hand analysis as a secondary reference |
| **G2 Dean × Daniel** | Anti-Debate on AI governance ([YouTube](https://www.youtube.com/watch?v=wkPsbwzyOa8)) | 4 × 12-min segments (one per phase), fully annotated. Whole-event crux and higher-ground reference. | Primary. Its published synthesis (third-party auditing and verification of frontier labs, preconditions for a US–China agreement, transparency requirements) is an external reference for higher-ground recall. |
| **G3 Anti-Debate playlist** | 2 more events from [the playlist](https://www.youtube.com/playlist?list=PLRN1pe0US2hS-mWZAiYJ8OMII8BcB6UXc) | 2 × 12-min segments each | Generalization across topics and moderators |
| **G4 Adversarial** | Hand-written short dialogues | 60 items | Red-team cases (§7) |
| **G5 Audio attribution** | Two volunteers with separate mics in a live room, plus mixed-feed recordings | 20 min | Diarization and bleed |

**Held-out rule:** one segment from each of G2 and G3 is never used for prompt iteration. All reported numbers come from held-out segments.

## 3. Annotation protocol

- **Annotators:** Benjamin plus one additional annotator with philosophy, debate or law training (recommended). Where possible, a participant-perspective check: the speaker, or someone who knows their work well, reviews that speaker's items.
- **Units:** ADUs with spans and speech acts; propositions (canonical + type + stratum + scope); stances (attitude, strength, credence); relations; bases; presuppositions (with a necessity judgment); questions and their status; updates; cruxes (top 3 per segment); higher ground (0–3 per event).
- **Process:** each annotator works independently, then they adjudicate together. Inter-annotator agreement is reported (Cohen's κ for categorical labels; span overlap F1). The model isn't expected to beat human agreement. Where κ is low, the ontology definition gets sharpened before the prompt gets tuned.
- **Tooling:** the operator console in "annotate" mode writes gold events to a separate session. The gold set is itself an event log, so the same projections and diffs apply.

## 4. Metrics

| Metric | Definition | Gate for live release (R1) | Target (R2+) |
|---|---|---|---|
| Attribution accuracy (post-operator) | Share of released items with correct participant | **100%** | 100% |
| A↔B swap rate (pre-operator) | Auto-attributed utterances credited to the wrong debater | ≤ 0.5%, and 0 unflagged | ≤ 0.2% |
| Proposition precision | Share of system propositions matching a gold proposition (span overlap ≥ 0.5 and canonical judged equivalent) | ≥ 0.90 | ≥ 0.95 |
| Proposition recall (central) | Share of gold propositions with centrality ≥ median that are found | ≥ 0.85 | ≥ 0.92 |
| Faithfulness | Share of released propositions judged "the speaker would sign this" (blind human judgment) | **≥ 0.97** | ≥ 0.99 |
| Hedge fidelity | Stance strength within one step of gold, and never stronger than gold | ≥ 0.95, 0 inflated by 2+ steps | ≥ 0.98 |
| Scope fidelity | Quantifier and domain match gold | ≥ 0.95 | ≥ 0.98 |
| Speech-act accuracy | On assert / concede / attribute / steelman_report / question / rhetorical_question / nonliteral | ≥ 0.92; attribute and steelman_report never committed to the speaker | ≥ 0.95 |
| Identity resolution F1 | `sameAs` merges versus gold | ≥ 0.85 | ≥ 0.92 |
| Relation F1 | By type; rebut/undercut/undermine reported separately | ≥ 0.75 overall | ≥ 0.85 |
| Presupposition necessity | Share of inferred presuppositions that annotators judge necessary | ≥ 0.85 | ≥ 0.92 |
| Crux agreement | Overlap of the system's top 3 with the adjudicated gold top 3, per segment | ≥ 0.6 | ≥ 0.7 |
| Higher-ground signability | Candidates both sides' proxies judge they "could sign" | ≥ 0.75 | ≥ 0.8, plus participant review |
| Higher-ground recall (G2) | Verified synthesis items (manifest `reference.publishedSynthesis`) recovered as candidates | ≥ 3 of 4 | 4 of 4 |
| Prompt usefulness | Facilitator rating of sampled prompts as "I'd ask this" | ≥ 0.6 | ≥ 0.75 |
| L1 latency | End of turn → approvable proposition, p50 / p90 | ≤ 10 s / 18 s | ≤ 6 s / 12 s |

## 5. Evaluation harness (`evals/`)

- `evals/run.ts --set G2 --segment held_out --passes L1,L2,L3,L4 --effort …` replays gold segments through the worker, writes a session, and diffs the projections against gold.
- Scoring scripts per metric; matching uses span overlap plus a model-assisted equivalence check, and humans audit a sample of every run's equivalence judgments.
- Every run records the prompt versions, model, effort, cost and latency. A results table in `evals/results.md` shows the trend over time.
- **Budget discipline:** full-event runs cost about as much as a live event (ARCHITECTURE §10). Iteration uses 12-minute segments. Full-event runs happen at milestones only.

## 6. Release gates

- **R0 (replay to Stephanie):** faithfulness ≥ 0.95 on a G2 held-out segment (spot-audited), and no attribution errors in the shown material, which is hand-verified because R0 uses offline diarization plus an operator relabel pass.
- **R1 (live, Oct 11):** every "Gate for live release" row in §4 is met on held-out G2/G3, plus:
  - a 90-minute full replay soak at 1× with no crash, lag ≤ targets and cost within the envelope
  - a G5 live-room test with 0 unflagged swaps
  - a rehearsal with the facilitator; she confirms the cockpit is glanceable
- **Feature-level gating:** a module that misses its gate (e.g., relation F1 for undercuts, or steelman assessment) is disabled for audiences and marked "operator-only" in the console. It is never shown half-built.

## 7. Red-team cases (G4, and live monitoring)

- A speaker quoting the opponent ("You're saying X") → must be `attribute`, not an assertion.
- Steelman reports in the steelman round → must not enter the steelmanner's store.
- Irony and sarcasm ("Sure, and the market will fix everything") → `nonliteral`, flagged.
- Hypotheticals ("Suppose licensing worked perfectly…") → scoped, not committed.
- Hedged numbers ("maybe 20, 30 percent") → a range, strength tentative, never a point.
- Double negatives and scope traps ("Not all regulation is bad" ≠ "Regulation is good").
- Mid-sentence interruption and completion after crosstalk → discontinuous spans.
- The same word in two senses within one speaker's turn.
- Rhetorical questions → `rhetorical_question` with the implied statement at ≤ `leaning`, shown beside the question; they don't enter the questions ledger. Genuine questions phrased pointedly stay `question`.
- Concessions buried in "yes, but" → a concession plus a qualification, both recorded.
- Loaded terms → kept quoted in spans, neutral in canonical text.
- A speaker retracting ("Actually, I take that back") → a `retract` event and a store update.
- Audience-mic interjections → attributed to "audience", never to a debater.

## 8. Live quality operations

- The console shows each item's validator and critic results. Overrides are logged with a reason.
- A post-event audit samples 50 released items for blind faithfulness judgment; the results are appended to `evals/results.md`.
- Participant review outcomes (confirm / amend / contest rates) are a first-class quality metric for every event.
