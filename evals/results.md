# Eval results

One dated entry per LLM run (HANDOFF §8). Until gold sets exist (QUALITY §2), runs are **hand-graded against ONTOLOGY §8** and the numbers below are indicative, not gate measurements. Grader is named on each entry; model-graded entries must be re-checked by a human before they count toward a gate.

## Trend

| Date | Run | Prompt | Model / effort | Turns | Cost | p50 / p90 latency | Props | Faithful (hand) | Validator flags (true / total) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-28 | DT t0020–t0031 | l1-extract-v0.1 | claude-opus-5-5 / medium | 12 | $0.49 | 11.2 s / 25.5 s | 50 | ~41/50 (82%) | 1 / 9 |
| 2026-09-28 | DT t0020–t0031 | l1-extract-v0.2 | claude-opus-5-5 / medium | 12 | $0.51 | 13.3 s / 22.8 s | 54 | ~51/54 (94%) | 1 / 4 |

QUALITY §4 gates for reference: faithfulness ≥ 0.97, L1 latency ≤ 10 s / 18 s.

---

## 2026-09-28 · DT t0020–t0031 · l1-extract-v0.2

Same 12 turns, same command. Changes: the prompt defines speaker-independence (use display names), polarity (only negations are normalised; no invented contraries), relation direction, particular-vs-general scope, comparatives, the commitment-producing acts, `certain` markers, conjunction splitting, and adopted versus reported citations. Validators: neutral-phrase lists for hedges and quantifiers, "one" dropped from number words, a new `non_committing_stance` guard, and stances on existing propositions are now validated. Grader: Claude (session agent). **Needs Benjamin's check.**

**Fixed from v0.1:** #1 deixis (canonicals now say "Aubrey Marcus's wife"; t0028's "100% certainly" is a `concede` on A's conditional), #2 contrary/relation inversion, #3 anecdote scope, #4 "less likely", #5 challenge → hedged assert, #6 rhetorical questions → `nonliteral` with no stance, #7, #8, #9, #10 (Montaigne and Epictetus now `assert` when adopted).

**Remaining / new:**
| Severity | Turn | Problem |
|---|---|---|
| Med | t0025 p2 | "this feels like a violation of value itself" resolved to *slavery*; in context "this" is B's relativist view (v0.1 had it right). Anaphora resolution is now the main failure mode. |
| Low | t0023 p1 | Courtesy preface ("I … receive the deep wisdom that is being transmitted here") became a `concede` + confident stance that B's view "contains deep wisdom". Signable, but it inflates common ground. The critic should rule on politeness formulae. |
| Low | t0030 p5 | "I might find out that I would … probably" at `leaning`; the validator caps it at tentative (true flag, defensible either way). |

**Validator flags:** 4, of which 1 is true (t0030 p5). False positives: "maybe" mentioned rather than used (t0029); "might" inside a content clause (t0030 p8); "Catan" named elsewhere in the same turn (t0031; fixed after this run by counting the turn text as antecedent context). Mention/use and clause-scoped hedges need the L2 critic, not more lexicon.

**Latency:** p50 13.3 s, p90 22.8 s; still over the gate. Long turns (t0026: 32.8 s) dominate. Next lever is L0: cap turns at ~45 s of speech. No effort change without gold data.

---

## 2026-09-28 · DT t0020–t0031 · l1-extract-v0.1

`pnpm --filter @adl/worker extract -- --fixture dt --turns 12 --skip 20 --llm`, then `pnpm --filter @adl/worker review -- --fixture dt`.
Grader: Claude (session agent), single pass. **Needs Benjamin's check.**

**Plumbing.** First call against the API succeeded unchanged: `beta.messages.create` + `output_config {effort, format: zodOutputFormat}` + `fallbacks: "default"`. 12/12 calls parsed; 0 refusals; 0 unlocated quotes. Cache reads 42,576 tokens across calls 2–12 (the frozen instructions + growing index prefix is working).

**Cost / latency.** $0.041 per turn → ~$11 for DT's 270 turns, in line with ARCHITECTURE §10's ~$10 L1 estimate. Latency p50 11.2 s, p90 25.5 s, max 31.6 s; long monologue turns (t0026, t0030) dominate. Misses the R1 latency gate; options are splitting long turns at L0, or an effort sweep (not changed without gold-set measurement).

**Output.** 56 ADUs, 50 propositions, 47 stances, 22 relations.

### Faithfulness problems found by hand (validators missed all of these)
| # | Severity | Turn | Problem | Rule |
|---|---|---|---|---|
| 1 | High | t0027, t0029, t0030 (p5, p6, p9) | Canonical text uses deixis: "the speaker", "the listener's wife". Propositions stop being speaker-independent; in t0028 B's stance attaches to "the speaker would forcibly stop it", which now reads as B's own commitment | D5, §2.3 |
| 2 | High | t0024 | B asserts "We make events positive or negative"; model invents the contrary "Events are intrinsically positive or negative" (new word "intrinsically") and records B **rejects**. Then relation p3 **supports** p2, the claim B rejects: direction inverted | §2.3 polarity, §8.2 |
| 3 | Med | t0022 p2 | Clients' reports ("when they go and look they discovered…") generalised to all perceived-terrible acts | §8.4 |
| 4 | Med | t0030 p9 | "less likely" became "unlikely" (comparative → absolute) | §8.1 |
| 5 | Med | t0023 | Stance attached to a `challenge` ADU; §2.2 says challenges don't change commitment stores. (The content is really a hedged assert: "I have a kind of a cautionary feeling that…") | §2.2 |
| 6 | Med | t0022 p5 | Rhetorical questions ("Why wait…? Why not just ask…?") extracted as an asserted prescriptive. §2.2 lists rhetorical questions under `nonliteral`, which can't commit. **Ontology question, see below** | §2.2, §8.6 |
| 7 | Low | t0023 p1 | "this" resolved as "every perceived terrible event" ("every" added) | §8.4 |
| 8 | Low | t0022 p4 | Conjunction not split ("challenges are necessary … and over-support keeps us dependent") | §2.5 |
| 9 | Low | t0020 p2, p6 | `certain` for unhedged "always"; the prompt reserves `certain` for explicit certainty | §8.3 |
| 10 | Low | t0026 d7, d10 | Approvingly cited authorities (Montaigne, Epictetus) labelled `attribute`, so B's evident endorsement is lost. Conservative, therefore safe, but it drops the expert-testimony basis | §2.6 |

### Validator false positives (8 of 9 flags)
- `new_number` "one" ×3: "one pole", "which side one takes": pronoun/determiner, not a number.
- `scope_widened` ×2: "in some ways" (hedge, not quantifier); "the most primitive form" (superlative, not quantifier).
- `hedge_inflated` ×3: "you might say, the Soul of the World" (parenthetical); "I wouldn't say maybe, maybe this is his belief" (the "maybe" is mentioned, not used); "where that might happen" (inside the content clause).
- True catch: t0030 p6, "I might find out that I would be favorable… probably so" at `leaning` (cap tentative). Defensible either way.

### Code gaps
- `mapL1Output` drops `bases` and `questions` from the model output; there is no event carrying them yet.
- Stances on **existing** propositions (identity-resolved via the index) skip validation: t0028's "probably … 100% certainly" → `certain` was never checked.

### Ontology question for Benjamin
Rhetorical questions that plainly assert ("Why not just ask the right questions?") are common in debate. §2.2 puts all rhetorical questions under `nonliteral` (never commits). Options: keep it strict (lose these claims), or add guidance that an *unmistakable* rhetorical assertion is extracted as `assert` with strength capped at `leaning` and flagged for the operator.
