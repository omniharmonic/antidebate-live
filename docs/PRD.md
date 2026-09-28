# Topology Live — Product Requirements

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28
**Companions:** [ONTOLOGY](./ONTOLOGY.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [UX](./UX.md) · [QUALITY](./QUALITY.md) · [IMPLEMENTATION_PLAN](./IMPLEMENTATION_PLAN.md)

---

## 1. Vision

Most disagreement is felt, not located. Two smart people talk past each other for an hour. They leave unsure whether they differ on facts, forecasts, values, definitions, or the unstated assumptions beneath all four.

Topology Live makes the structure of a disagreement visible while it happens, precisely enough that an expert moderator trusts it and plainly enough that an audience can follow it. Concretely, it:

- **Maps** each participant's assertions as quote-anchored propositions. Each proposition is typed (empirical, causal, predictive, normative, prescriptive, definitional). Each carries its modality, scope, conditions and credence exactly as spoken.
- **Grounds** each assertion in its **epistemic basis** (how the speaker claims to know it) and its **ontological basis** (what it presupposes exists or holds).
- **Relates** assertions across speakers with a formal attack/support vocabulary. It separates rebutting a conclusion, undercutting an inference, and undermining a premise.
- **Locates** disagreement on specific shared propositions, then finds the **cruxes**: the propositions whose resolution would move both parties.
- **Proposes higher ground**: propositions or actions both could accept given everything they have committed to, each with its derivation and its cost to each side.
- **Tracks the dialogue game**: commitments, concessions, updates, questions asked, answered and evaded, steelmans offered and confirmed, and credences as they move.
- **Serves each person in the room what they need.** The facilitator gets a calm cockpit. The operator gets full control. The audience gets exactly the level of detail the facilitator sets, from nothing to everything.
- **Becomes a permanent artifact.** A playback explorer shows the recording, synced transcript, and full map (including a 3D topology) at any moment.

It does not declare winners. It does not fact-check live. It never presents a machine inference as something a person said.

## 2. Principles

1. **Fidelity over fluency.** Every item is either a verbatim quote or a canonical proposition traceable to one. When in doubt, quote.
2. **Structure over summary.** The product's value is the typed graph, not prose about it. Generated prose is short and cites node ids.
3. **Epistemic status is always visible.** Stated, inferred, operator-approved, speaker-confirmed, canonical and live-provisional are rendered differently everywhere.
4. **The humans are the event.** Outputs support the conversation and never compete with it. Exposure is set by the facilitator, moment to moment.
5. **No false synthesis.** Higher-ground proposals must show their derivation and what each side gives up. Genuine, irreducible disagreement is a valid and honored output.
6. **No slop.** No filler language, no decorative AI aesthetics, no unverifiable numbers, no emoji. Precision in words and in pixels. See UX §2.
7. **Everything replayable.** If the room saw it, playback can show it, with the exact moment it appeared and who approved it.

## 3. Users

| Role | Needs | Primary surface |
|---|---|---|
| **Facilitator / moderator** (e.g., Stephanie Lepp, or a moderator with a game-theory background) | At a glance: what the live crux is, where they already agree, what higher ground is emerging, and one good question to ask next. Control over what the audience sees, without looking away for more than two seconds. | Facilitator cockpit (tablet) + dial controls |
| **Operator** (Benjamin on Oct 11) | Full-fidelity view of the pipeline. Confirm speakers. Approve, edit, merge or reject extractions. Curate what reaches the facilitator. Run the dial on the facilitator's behalf. Monitor health. | Operator console (laptop) |
| **Debaters** | By default: nothing during the debate. Optionally: confirm a steelman ("is this you?") or correct their own map after the event. | Optional confirmation tablet; post-event review |
| **Live audience** | Follow the structure at the depth the facilitator allows. | Stage display, livestream overlay, optional phone view |
| **Remote / later viewers** | Watch the debate with everything visible, navigate by claim, crux or moment, and share precise links. | Playback explorer |
| **Judges** (formats that score intellectual honesty and updating) | Evidence, not verdicts: concessions, updates, steelman confirmations, questions answered and evaded, with timestamps. | Judge panel (a cockpit mode) and playback |
| **Organizers / producers** | Prep the event, check AV, publish the playback. | Event setup; publish flow |

## 4. Surfaces

1. **Facilitator cockpit.** A tablet at the moderator's seat, tuned to be glanceable. Shows the crux, common ground, higher ground, one prompt, the round and timer, and audience dial controls. See UX §3.
2. **Operator console.** A laptop view with the live transcript, speaker confirmation, extraction queue, insight queue, the full map, pipeline health and cost. See UX §4.
3. **Stage output.** Projector, full-bleed, cinematic. Renders the current audience level. 2D map or 3D topology, both calm. See UX §5.
4. **Livestream overlay.** A transparent browser source for OBS or vMix, with its own dial level. See UX §5.4.
5. **Audience phone view.** Optional, via QR code. Own dial level, never above the stage level unless the facilitator allows it. See UX §5.5.
6. **Playback explorer.** Video + synced transcript + all lenses + 3D topology + scrubbable time. See UX §7.
7. **Setup & prep.** The event, participants, mics, rounds, voice enrollment, priors and briefing. See UX §8.

## 5. Feature set

Tags: **[B]** = Stephanie's baseline must-have. **[N]** = her nice-to-have. **[V]** = the broader vision.

### 5.1 Capture and attribution
- F1 In-person multi-channel capture: one mic per participant plus the moderator, with optional audience-Q&A and room mics. [B]
- F2 Remote/hybrid capture: per-participant Zoom streams; mixed livestream feeds. [V]
- F3 Always-on speaker attribution: channel gate, streaming diarization, sound-check voiceprints, confidence fusion, and operator confirmation. No unconfirmed low-confidence line reaches an audience output. [B]
- F4 Word-level timestamps, kept end to end. [V]
- F5 Recording of the audio (and video, when available) aligned to the event clock, for playback. [V]

### 5.2 Mapping (the ontology in ONTOLOGY.md)
- F6 Argumentative discourse unit segmentation with speech-act typing: assert, concede, question, answer, hypothesize, steelman-report, attribute-to-other, retract, joke/irony. [V]
- F7 Proposition extraction with type, modality, scope, conditions, time horizon, credence, and verbatim spans. [B]
- F8 Proposition identity resolution across speakers and turns, which puts both people's stances on the *same* proposition. [B]
- F9 Epistemic basis per assertion (15 types; ONTOLOGY §4) and cited sources as entities. [V]
- F10 Presuppositions and ontological commitments (inferred, marked), placed on worldview strata. [V]
- F11 Relations: support (with argumentation scheme), rebut, undercut, undermine, qualify, concede, agree, equivalent, presuppose, define, exemplify, answer, evade. [B]
- F12 Concept lexicon: each speaker's sense of load-bearing terms, and **semantic drift** detection. [N]

### 5.3 Insight (derived, gated)
- F13 **Crux detection**: double-crux candidates ranked by how much other disagreement depends on them. Each has an "each side would update if…" statement. [B]
- F14 **Higher ground**: synthesis candidates typed by construction (domain partition, conditionalization, value lift, incompletely theorized agreement, sequencing, Pareto move). Each carries its derivation and its cost to each side. [B]
- F15 **Facilitator prompts**: questions, never verdicts. Silence is the default; prompts are ranked by expected clarifying value. [B]
- F16 **Steelman check**: A's restatement of B compared with B's commitment store, showing captured, missed and distorted items, plus B's confirmation. [N]
- F17 **Questions ledger**: who asked what of whom, and whether it was answered, partly answered, deferred or evaded. [V]
- F18 **Updates & concessions ledger**: stance changes with their trigger and timestamp. [V]
- F19 **Credence board**: stated probabilities and forecasts, with deltas over the event. [V]
- F20 **Inflection points & roads not taken** (from DT's flow schema): produced in the canonical pass. [V]
- F21 **Ask the map**: natural-language questions over the event graph for the operator and facilitator ("Where do they agree on enforcement?"). [V]

### 5.4 Exposure control
- F22 **Audience detail dial**, levels 0–5 (§6), set per output channel. [V; Stephanie's default is level 0]
- F23 Per-module toggles: crux, common ground, higher ground, questions, credences, drift, transcript, polls. [V]
- F24 Reveal queue (hold, then publish at a round break), **Blackout** hotkey, **Spotlight** (push one card full-screen), and freeze. [V]
- F25 Debater-visible mode: off by default; optional steelman confirmation tablet. [V]

### 5.5 Playback and publication
- F26 Playback explorer: synced video/audio, transcript, map state at time *t*, and chapters by round. [V — user requirement]
- F27 "As seen live" versus "canonical" toggle, with a diff between them. [V]
- F28 Lenses: Argument Map (2D), **3D Topology**, Positions Matrix, Crux Tree, Flow/Timeline, Concept Lexicon, Evidence Ledger, Questions, Updates, Credences, Steelman Arena, Worldview Fingerprints. [V; take-home explorer = N]
- F29 Deep links to any moment, proposition, crux or view state. [V]
- F30 Exports: JSON bundle (including DT-compatible), markdown report, map images. [V]
- F31 Participant review: each debater can confirm, amend or contest their own map before publication. [V]

### 5.6 Prep
- F32 Round templates (Anti-Debate, Oxford, Socratic, open), configurable timings. [B]
- F33 Participant priors: optional fingerprint of each debater from their prior writing (the Ontography ingestion lineage), clearly marked as inferred. [V]
- F34 Topic landscape: known cruxes and positions in the debate's domain, for facilitator briefing. [V]
- F35 Facilitator briefing document, generated pre-event and reviewed by the operator. [V]

### 5.7 Optional audience participation (off by default)
- F36 Pre/post credence polls on the resolution and key cruxes, with a "what moved you" free text. [V]

## 6. The audience detail dial

Each output channel (stage, livestream, phones) has its own level. The facilitator's cockpit shows all of them and can link them. Changes take effect on the next approved render, fading over 600 ms.

| Level | Name | What the audience sees |
|---|---|---|
| 0 | **Dark** | Nothing, or a neutral slate with the event title. *Stephanie's Oct 11 default.* |
| 1 | **Frame** | Round name, the question on the table, and a round timer if the facilitator wants it. |
| 2 | **Positions** | Each participant's 1–3 core theses as approved propositions, with epistemic badges. |
| 3 | **Clash** | Positions, plus the current crux(es) and confirmed common ground. Higher ground appears when the facilitator releases it. |
| 4 | **Map** | The approved argument map (2D) or 3D topology, including relations, drift markers, and question and update ledgers. |
| 5 | **Full** | Everything at level 4, plus the live transcript with highlighted assertion spans and inferred layers (presuppositions, schemes) shown as inferred. |

Module toggles override within a level (for example, level 3 with higher ground held back). **Reveal** mode buffers changes until released. **Blackout** drops every audience channel to level 0 instantly. **Spotlight** pushes a single approved card (a crux, a higher-ground candidate, a steelman confirmation) full-screen.

## 7. Formats

Rounds are data. Each round defines a name, a duration, speaking order, what the pipeline emphasizes, and the default dial behavior at its boundaries. Templates:

- **Anti-Debate** (to be finalized against the how-to guide, which is blocked from the cloud build environment). Known structure: it opens like a debate (openings, rebuttals, direct argumentation and cross-examination), then moves into steelmanning and integration aimed at "higher ground". Participants may be judged on intellectual honesty and willingness to update. Pipeline emphasis by phase: positions → clash and questions ledger → steelman check → higher ground and updates.
- **Oxford**, **Socratic**, **Open dialogue** — later templates.

## 8. Release scope

| Release | Date | Scope |
|---|---|---|
| **R0 Replay** | Fri 2026-10-02 | Offline pipeline on the Dean Ball × Daniel Kokotajlo Anti-Debate and the DT fixture. A replay page for Stephanie showing the cockpit, a static map at levels 2–4, cruxes, higher ground and prompts over time. |
| **R1 Event Edition** | Thu 2026-10-08 freeze → Sun 2026-10-11 | Live capture (in person), full live pipeline with critic pass, operator console, facilitator cockpit, dial with stage output (levels 0–4, 2D map; 3D stage mode only if it passes the stability gate), recording, event log. |
| **R2 Playback** | Sun 2026-10-25 | Canonical pass, playback explorer with 3D topology and core lenses (Argument Map, Positions Matrix, Crux Tree, Flow, Questions, Updates), participant review, publish. |
| **R3 General** | Nov 2026 | Zoom/hybrid, livestream overlay, phone view, polls, full lens set, priors and briefing, multi-event library, format templates beyond the Anti-Debate. |

Nothing ships to a live room below its quality gate (QUALITY §6). A feature that misses its gate is disabled, not shown half-built.

## 9. Success metrics

**Oct 11 (Stephanie's bar: "adds clarity; doesn't muddle")**
- Stephanie rates it 4 or 5 of 5 on "clarified the arguments, the disagreement and the synthesis", and 4 or 5 of 5 on "never pulled my attention the wrong way".
- Zero misattributed items reach her cockpit or any audience output.
- Median time from end of an utterance to an approvable proposition ≤ 10 s. Crux or higher-ground candidates at every round boundary.
- No outage longer than 30 s. Graceful degradation throughout.

**Quality (continuous; QUALITY §5)**
- Proposition faithfulness ≥ 97% and attribution accuracy 100% (after operator) on gold sets.
- Crux agreement with expert annotators ≥ 0.7. Higher-ground candidates rated "both sides could sign" ≥ 80% by the participants' own review.

**Playback**
- Median session ≥ 8 minutes. At least 30% of viewers open a crux or proposition detail.

## 10. Non-goals

- Live fact-checking or truth verdicts. The evidence ledger marks claims as *checkable* and records what was cited; it does not adjudicate.
- Automated scoring of participants. Judges get evidence ledgers, not scores.
- Persuasion analytics or rhetoric scoring.
- Any display to debaters during the debate unless the facilitator enables it.

## 11. Constraints and ethics

- **Consent:** participants agree to live mapping and to publication. Playback publication requires every participant's review window to close (F31).
- **Representation:** inferred layers are marked as inferred everywhere. Participants can contest any item. Contested items stay visible and are labeled "contested by speaker".
- **Privacy:** raw audio stays local during the event. Recordings are published only with consent.
- **Attribution:** built by Benjamin Life (@omniharmonic). The Anti-Debate format is Synthesis Media's. The product is format-agnostic and doesn't use their branding.
