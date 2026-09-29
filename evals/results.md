# Eval results

One dated entry per LLM run (HANDOFF §8). Until gold sets exist (QUALITY §2), runs are **hand-graded against ONTOLOGY §8** and the numbers below are indicative, not gate measurements. Grader is named on each entry; model-graded entries must be re-checked by a human before they count toward a gate.

## Trend

| Date | Run | Prompt | Model / effort | Turns | Cost | p50 / p90 latency | Props | Faithful (hand) | Validator flags (true / total) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-28 | DT t0020–t0031 | l1-extract-v0.1 | claude-opus-5-5 / medium | 12 | $0.49 | 11.2 s / 25.5 s | 50 | ~41/50 (82%) | 1 / 9 |
| 2026-09-28 | DT t0020–t0031 | l1-extract-v0.2 | claude-opus-5-5 / medium | 12 | $0.51 | 13.3 s / 22.8 s | 54 | ~51/54 (94%) | 1 / 4 |
| 2026-09-28 | DT t0020–t0031 | l1-extract-v0.3 | claude-opus-5-5 / medium | 12 | ~$0.5 | — | — | rhetorical questions now extracted as implied statements (2/2 correct); t0025 misresolution persists | — |
| 2026-09-28 | Ball×Kokotajlo 5–16 min, full engine | l1 v0.3, l2-critic v0.1, round v0.1, l3 v0.1, l4 v0.1 | opus-5-5 / per pass | 27 turns | $1.63 (67 calls) | L1+L2 ≈ 15 s per ~25 s turn | 60 | critic: 29 pass / 12 repair / 2 reject | — |

QUALITY §4 gates for reference: faithfulness ≥ 0.97, L1 latency ≤ 10 s / 18 s.

---

## 2026-09-29 · Ingest 5: Open-Source AI (Stephanie Lepp hosting, Jenny Stefanotti moderating; Jeremy Nixon × Daniel Barcay) · open-source-ai-r1 · 2h16 · subscription, $0

Round-3 code (convergence, card stability, l4 v0.2, l3 v0.3). 767 calls, $0 billed.
- **Richest structure so far:** 573 approved claims, 22 clashes, **6 shared** (stated + converging), 4 merges. Stated disagreements are still 0: in this format debaters rarely restate each other's claims, so disagreement surfaces as clashes, which the crux card labels as inferred from opposing claims.
- **Card stability works:** 18 distinct higher-ground ideas over 136 minutes (Belief in God had 28 variants in 94). Crux changed 6 times, each at a real turn in the argument ("open source keeps powerful forces honest" → "open source AI is central to avoiding centralization" → "a lot of behavior nobody understands can be smuggled into AI systems").
- **Higher ground, examples:** "'Open' in AI is a spectrum… claims should be tested at each point, not for 'open source AI' as one label" (domain_partition); "Risks that fall mainly on the person who chooses them can be left to individual choice, while risks that spread to people who never opted in warrant shared standards"; closing: "Open source AI is on net good but is not the cure-all it was promised to be…".
- **Rounds:** 11 named, but they jitter (Steel-Manning 36.0 → Open Debate 36.3 → Steel-Manning 50.0). Fix: a code-level sequence guard (never back to an earlier phase; a within-phase step back only after 3 minutes), with tests.
- 18 unattributed utterances (audience Q&A); they never enter the map.

**Ingest loop complete: all six playlist videos processed, $0 API.**

---

## 2026-09-29 · Ingest 4: Destiny × Michael Shermer (Alexander Beiner facilitating, Stephanie Lepp hosting) · destiny-shermer-r1 · subscription, $0

Run with the round-2 code (it started before the round-3 fixes). 513 approved claims, 10 clashes, 1 shared; both co-moderators attributed correctly (MOD, MOD2); 0 unattributed utterances.
- **Rounds: 5 of the named rounds.** Nothing between Rebuttals (35m) and Closings (90m), because Alexander runs his own structure: "next phase… From Dusk Till Dawn" (49.6m: trust and values), "scenarios" (68.2m), Stephanie's integration questions (76.8m). The detector correctly refused to force-fit names. Fix: `formats.ts` gains adapted rounds per phase ("Exploring Synthesis (moderator's own structure)"), and round-detect-v0.3 chooses them when a moderator clearly opens a new phase in their own words. Rerun of rounds only: synthesis detected at 49.2m. Opening/Connection labels swap once at 9.6–25m (a personal-story round framed like an opening); phases are right.
- **Crux quality:** one crux was "Michael Shermer is interested in the truth", a claim about a participant, not the question. Fix: code drops crux candidates that are claims about a debater, and L4 is told the same.
- **Higher ground: strong.** "Where a question is genuinely unsettled or turns on definitions, give the strongest versions of each side a hearing; where bad-faith falsehoods crowd out the real questions, hold those actors accountable" (domain_partition).
- **Ignite talk** (one speaker, 5 min): 30 calls, $0, no crash; correctly no crux, higher ground or shared ground; prompts only.

---

## 2026-09-29 · Ingest 3: The Value of Belief in God (Stephanie Lepp moderating; Jim Rutt × Layman Pascal) · belief-in-god-r1 · subscription, $0

Prompts: l1 v0.4, l2 v0.2, round v0.2, l3 v0.3, l4 v0.1 (+ name→key fix). 503 calls, $0 billed.
- **Rounds 12/12.** Clashes 15 (Gender-Affirming Care had 9).
- **Higher ground now flows** (the name→key fix), and it's the best output so far, e.g. "The hole left by the death of God is real, and it is cognitive, psychological and cultural. It is best filled by well-crafted, up-to-date practices… whether the word 'God' is the right name for what fills it is a separate question." That is the format's higher-ground move exactly (a `value_lift` / naming split).
- **Crux:** moves through "anchoring effects of religion are now destructive" → "whatever fills the God-shaped hole is the definition of God" (a *stated* disagreement: Rutt rejects, Pascal accepts) → "the God experience gives some information through perception". A sensible path.
- **Problems:** (1) **card churn**: 28 higher-ground variants of ~8 ideas, reworded every pass; (2) **shared ground** still 2 stated and 1 merge. Agreement shows up as cross-speaker `agrees` relations instead (8 here, 3 in Gender-Affirming Care, 2 in Ball × Kokotajlo).
- **Round-3 fixes:** ONTOLOGY §4.3a **convergence** (cross-speaker `agrees` pairs, each side accepting its own claim; inferred; shown as "converging" under Already shared, never counted as common ground). **Card stability** in code: a crux on the same proposition, or higher ground / prompts with word overlap ≥ 0.7 to a recent card, are not re-emitted. l4-insight-v0.2 returns still-valid cards unchanged.

---

## 2026-09-28 · Ingest 2: Gender-Affirming Care (Stephanie Lepp moderating; Layman Pascal × Shereef Bishay) · run gac-r1 · subscription, $0

Prompts: l1 v0.4, l2 v0.2, round v0.2, l3 v0.2, l4 v0.1. 519 calls (rounds 79, L1 132, L2 113, L3 27, L4 29), all on the subscription, $0 billed.
- **Rounds: 12/12 in order**, including the optional Check-In and Contemplation, even though this is the earlier trial-run version of the format.
- **Cruxes:** 27 cards. The main axis ("permanent interventions on minors should require …" / "trustworthy experts aren't known to be in place") was stable from the rebuttals on.
- **Higher ground: 0 cards emitted, a bug.** L4 proposed good candidates ("For now, no permanent medical intervention on a minor unless a check exists that the experts aren't captured…"), but it wrote display names instead of keys in `derivation`, and code discarded every one as coming from an unknown participant. Fixed (names → keys for derivation, costs and update conditions, with a test).
- **Map:** 236 approved claims, still **0 stated disagreements / 2 shared**. Only 4 stances in the run cross speakers; one leaked a display name as its participant key. Fixes: the L1 mapper always uses the turn's speaker; l3-link-v0.3 gets up to 3 lexically similar claims from the *other* speaker for each new claim, from anywhere in the map (no model), so paraphrase merges aren't limited to the recent window.
- **Critic:** 157 pass / 95 repair / 15 reject (35% repair; scope 38, hedge 24). High, but the repairs are narrowing, which is the intended direction.
- **Subscription overhead:** each `claude -p` call carries ~5.8k tokens of fixed context, served from cache after the first call. `--disable-slash-commands` / `--setting-sources` don't reduce it.

---

## 2026-09-28 · Full run r1 (Opus 5.5, API) · Ball × Kokotajlo to minute 80 · stopped for cost

308 calls, **$13.89 billed**: L1 $5.29 (the whole claim index re-cached on every call), L4 $3.68 and L3 $2.94 (whole map, uncached, every ~4 turns), L2 $1.90, rounds $0.09. It was stopped at minute 80 of 86 and saved (`ball-kokotajlo-r1`, pushed to Neon).
**Changes since:** the subscription provider is the default ($0 API), Sonnet 5.5, a response cache, an API budget cap, a bounded L1 index (60) and L3/L4 map (~70), and insight passes every 6 turns.

Diagnostics (`pnpm --filter @adl/worker diagnose -- --session ball-kokotajlo-r1 --fixture ball-kokotajlo-ai-governance`):
- **Rounds:** 7 detected, in order, to Red-Teaming (45.6m); Exploring Integration, Closings and Outro were missed. Cause: the moderator's announcement spans several short turns and the detector saw one at a time. round-detect-v0.2 (previous moderator turns plus the usual order) found **all 11 rounds** in a rounds-only rerun (31 subscription calls, $0).
- **Map:** 263 approved claims but **1 stated disagreement and 1 shared claim**. Responses became new claims instead of stances on the other side's claims, so the cockpit's "Already shared" quadrant was nearly empty and every crux was clash-based. Fixed in l1-extract-v0.4 (responses attach to existing claims; the index shows who holds each) and l3-link-v0.2 (paraphrase merges across speakers).
- **Higher-ground recall (hand-judged): ~3 of 4** verified items. Auditing ("Independent auditing of frontier labs is worth building…", 41m), checks on concentrated power ("…whether it strengthens checks like courts, Congress and independent auditors rather than concentrating control in the federal executive", 48m), and partly verification under uncertainty ("Start now with transparency and independent verification…", 51m). Missing: US–China deal preconditions (discussed at ~44m and ~83m; the run ended at 80m).
- **Crux history:** concentration of power should be regulated (18m) → checks and balances will spread power over AIs (28m) → automating AI research speeds it dramatically (36m). This matches reference cruxes 1 and 4.
- **Critic:** 206 pass / 65 repair / 9 reject. **Prompts:** 93, 19 to both, all speakable.

---

## 2026-09-28 · Engine test · Ball × Kokotajlo minutes 5–16

`pnpm --filter @adl/worker run:session -- --fixture ball-kokotajlo-ai-governance --session bk-test1 --speed 8 --from 5 --to 16 --file`. The whole live path: feeder → log → turns → L1 → L2 → auto-approval → rounds → L3 + L4 in the background. Grader: Claude (session agent).

- **Keeps up with live speech.** L1+L2 take ~15 s for a ~25 s turn (TurnBuffer window), and L3/L4 run beside it without blocking. The first debater turn after a round change gets cards at the next insight pass.
- **Rounds:** "Opening Statements" was detected from the moderator's handover; nothing spurious.
- **Critic (l2-critic-v0.1):** 43 items, 29 pass, 12 repair, 2 reject. Repairs were well judged: they dropped an added "publicly", restored "it seemed" framing, turned a widened "within five years" back into "next year or five years from now", and moved "will" to "may" after "we don't know". Two repairs reintroduced "we" (deixis); fixed in l2-critic-v0.2.
- **Crux:** once Dean's opening began, L3 linked "Government stepping in to shape the trajectory of AI is bad" (Dean) as rebutting "The concentration of power from AI should be regulated" (Daniel), and L4 made it the crux (`basis: clash`). That is the debate's actual axis. Bugs fixed after this run: the clash side was missing from the card, and `downstream` ids were mis-parsed.
- **Prompts** were specific and speakable, e.g. "Dean, Daniel's chain runs from an army of geniuses, to a 10x–1000x research speed-up, to superintelligence, to decisive power for whoever controls it. At which step, if any, do you part ways?" Addressees returned as names are now mapped to keys.
- **Cost:** 11 minutes of debate, $1.63. Projected full event ≈ $12–15, which fits ARCHITECTURE §10's ~$30 live envelope.

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
