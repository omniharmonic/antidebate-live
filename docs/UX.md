# Topology Live — Experience Specification

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28

---

## 1. The experience in one paragraph

The facilitator glances down and sees, in under two seconds: what the disagreement currently hinges on, what the two already share, what higher ground is forming, and one question worth asking. At the back of the room, the operator steers a precise instrument. The audience sees exactly as much as the facilitator decides, from nothing to the whole topology. Afterwards, anyone can press play and watch the conversation and its structure unfold together. Nothing on any screen is filler.

## 2. Design language and the anti-slop rules

**Open Field** is inherited from Dialectical Topology:
- a light field (#FAFAFA) with an ink scale
- per-participant voice colors (warm/cool pairs generated per event, checked for contrast in both themes and for color-blind separation)
- violet for convergence and higher ground
- amber for drift and insight, used rarely
- a dark "stage" variant for projection and the dimmed cockpit

Type: Instrument Serif for display, Inter for text, JetBrains Mono for timecodes, credences and ids.

**Rules (enforced in design review and in prompts):**
1. Every string is a verbatim quote, a canonical proposition, a label from the ontology, or a sentence of ≤ 25 words that cites node ids. There are no generated "summaries" in audience outputs.
2. No emoji, no sparkle icons, no gradient blobs, no glassmorphism, no "AI thinking" shimmer. Motion is limited to arrival (fade and settle, 400–700 ms), focus, and time.
3. Numbers appear only if a participant said them, or if they're computed counts with a visible definition (e.g., "3 open questions").
4. Epistemic status is always encoded:
   - solid = stated by the participant
   - hairline outline = operator-approved
   - translucent + "inferred" micro-label = machine inference
   - double rule = participant-confirmed
5. Speech act is visible where it matters: concessions are marked, and steelman reports never appear in the steelmanner's column.
6. No red/green "winner" coding. Disagreement uses both participants' colors meeting; agreement uses violet.
7. Every item links to its moment, in the console and in playback.

## 3. Facilitator cockpit (`/cockpit`, tablet, landscape)

Designed for the chair on stage: dark theme at low brightness, large type (minimum 22 px body, 36 px for the crux), no sound, no vibration. Updates appear only when the operator sends them, or through auto-approval rules the facilitator agreed to beforehand.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ROUND 3 · STEELMAN            18:42 in round        AUDIENCE ● Dark   [dial] │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ THE CRUX NOW                         │ HIGHER GROUND (candidate)             │
│ "Concentrated regulatory control is  │ Independent third-party audits of     │
│  more dangerous than distributed     │ frontier labs, starting now.          │
│  private control."                   │ A gives up: licensing, for now        │
│ A ▲ rejects   B ▲ accepts            │ B gives up: nothing mandated beyond   │
│ Settles by: values clarification    │ audits                    [spotlight] │
├──────────────────────────────────────┼───────────────────────────────────────┤
│ ALREADY SHARED                       │ TRY ASKING                  1 of 3 ▸  │
│ · Labs shouldn't grade their own work│ "B, what would a licensing agency     │
│ · Some form of audit is needed       │  have to look like for you to accept  │
│                                      │  it?"  (undercuts P4)   [used] [skip] │
├──────────────────────────────────────┴───────────────────────────────────────┤
│ Open questions 2 · Updates 1 (B, on audits, 12:31) · Steelman: B confirmed ✓ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Four quadrants, always in the same place**: crux, higher ground, shared, prompt. The strip at the bottom holds the ledgers.
- **Tap to expand** any quadrant into detail (spans, derivation, alternatives). It auto-collapses after 20 s.
- **Dial control:** a single tap opens the channel sheet (stage / livestream / phones), with levels 0–5, module toggles, Reveal, Blackout (hard, top-right, always visible) and Spotlight.
- **Round control** (optional, can be left to the operator): next round, pause.
- **Modes:**
  - *Glance* (default)
  - *Break* (at round boundaries: a fuller map and a round digest of positions, clashes, movement and open questions)
  - *Judge* (for scored formats: evidence ledgers per participant, never scores)
- **Stephanie's Oct 11 configuration:** Glance mode, audience Dark, prompts on, higher ground on, crux on, drift available on expand, steelman in the ledger strip.

## 4. Operator console (`/console`, laptop, 1440+ px)

```
┌ Health: capture ● ASR 0.6s ● L1 5.2s ● L3 18s ● $11.40 ● net ● ─────────────────────────┐
├─────────────────────┬──────────────────────────────────────┬──────────────────────────────┤
│ TRANSCRIPT          │ EXTRACTION QUEUE                     │ MAP (2D ⇄ 3D)                │
│ 12:04 A ███ 0.97    │ P17 predictive  A leaning            │                              │
│ "I think if we..."  │ "Absent third-party auditing…"       │   [live topology]            │
│ 12:31 ? ██░ 0.58    │  span ✓  entities ✓  hedge ✓  critic ✓│                              │
│ [1][2][M][Q]  held  │  [approve] [edit] [merge→P9] [reject]│                              │
│                     ├──────────────────────────────────────┤                              │
│                     │ INSIGHTS → facilitator               ├──────────────────────────────┤
│                     │ CRUX c3 score 7.2  [send] [hold]     │ OUTPUTS                      │
│                     │ HG h2 ITA          [send] [hold]     │ stage L0 · stream — · phones —│
│                     │ PROMPT q5          [send]            │ [Blackout] [Reveal queue: 3] │
└─────────────────────┴──────────────────────────────────────┴──────────────────────────────┘
```

- **Keyboard-first:**
  - `1`/`2`/`M`/`Q` assign speakers
  - `A` approve, `E` edit, `R` reject, `G` merge
  - `S` send to the facilitator
  - `B` blackout, `.` reveal queue
- **Validator and critic badges** on every item. Failed items can't be approved without an explicit override, which is logged.
- **Auto-approve policies** per item type (e.g., auto-approve stated propositions that pass every check with attribution ≥ 0.9). They're off by default for insights.
- **Ask the map:** a query box ("where do they agree on enforcement?") returns cited nodes. It's operator-only by default.
- **Inconsistency and evasion flags** are private here and only reach the facilitator if sent.

## 5. Audience outputs

### 5.1 Stage (`/stage/stage`)
Full-bleed, dark stage theme, readable from 20 m. Renders the channel's dial level:
- **L0 Dark:** the event title slate, or black.
- **L1 Frame:** the round title and the question on the table, set in display serif.
- **L2 Positions:** two columns, 1–3 theses each, each with an epistemic badge.
- **L3 Clash:** positions + a centered crux band where the two colors meet + a shared-ground strip. Higher ground rises above the band when it's released.
- **L4 Map:** the 2D stratified map, or the 3D topology in cinematic mode.
- **L5 Full:** the map + a lower-third live transcript with the asserted spans underlined.

Transitions happen only between approved states, with a 600 ms crossfade. Nothing blinks.

### 5.2 Spotlight
One card, full-screen: a crux, a higher-ground candidate, a steelman confirmation, or an update ("B updated on audits, 12:31"). It dismisses on facilitator command.

### 5.3 Reveal mode
Changes queue up, and the facilitator releases them all at a chosen moment (typically between rounds). The queue count is visible in the cockpit and console.

### 5.4 Livestream overlay (`/overlay/:channel`)
A transparent background with lower-third and side-panel layouts, sized for 1920×1080. It has its own level; the default is one above the stage level for online viewers, if the facilitator allows.

### 5.5 Phones (`/p/:event`)
A QR code opens a follow-along view at the phone channel's level. Tapping a proposition shows the exact quote. Optional polls (PRD F36) live here.

## 6. The 3D topology (interactive and cinematic)

- **Space:** participant hemispheres on X; strata on Y (ontology at the base, praxis at the top, higher ground floating above); time on Z (collapsible). Shared propositions sit on the median plane.
- **Reading it:**
  - A disagreement is a pair of nodes, one in each hemisphere, joined by a rebut or undercut edge.
  - A crux is a **fault plane**: a thin vertical sheet through the median, anchored at the crux node's height. Its height shows *how deep* the disagreement runs.
  - Higher ground is a node above the median with filaments down into both hemispheres, to the commitments it's derived from.
- **Interactions:**
  - hover: canonical text + speaker quote
  - click: detail panel with spans (seek media), stances over time, relations, bases, presuppositions
  - `F` focuses a node's neighborhood
  - `T` toggles time depth
  - `L` changes layout (strata / semantic)
  - `I` hides the inferred layers
  - a lens switcher
- **Filters:** by participant, type, stratum, status (stated / inferred / canonical), round, and time window.
- **Cinematic mode** (stage): deterministic slow orbit; newly released nodes are framed and then the camera returns; no HUD.
- **Growth replay:** in playback, the topology grows with the playhead, so the shape of the argument forms in front of you.

## 7. Playback explorer (`/play/:event`)

```
┌───────────────────────────────┬──────────────────────────────────────────────────┐
│ VIDEO                         │ LENS: [Topology 3D] Map Positions Cruxes Flow …  │
│                               │                                                  │
│                               │            (map state at playhead)               │
├───────────────────────────────┤                                                  │
│ TRANSCRIPT (follows playhead) │                                                  │
│ 12:04 A  I think if we don't  │                                                  │
│   ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾ P17         │                                                  │
├───────────────────────────────┴──────────────────────────────────────────────────┤
│ ▶ ──●──────────────────────────────────────────── 1:28:40   [canonical ⇄ as seen live]│
│   R1 Openings │ R2 Rebuttals │ R3 Steelman │ R4 Integration     ◆crux ▲update ○question│
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Lenses:**
- **Topology 3D:** §6.
- **Argument Map:** 2D stratified; the print-quality view.
- **Positions Matrix:** propositions × participants, with stance glyphs (accepts ●, rejects ○, suspends ◐, conditional ◑), strength by weight, credence as a number where stated, and change markers over time. Sortable by disagreement or crux score. This is the moderator's favorite view: disagreement as a table.
- **Crux Tree:** each disagreement with its crux chain descending through strata to where the two graphs part, in the lineage of "where does our agreement stop?" from Ontography.
- **Flow:** DT's temporal lens. Rounds, intensity, inflection points and roads not taken (from the canonical pass).
- **Concept Lexicon:** terms × participants' senses, with drift highlighted and the propositions where the drift matters.
- **Evidence Ledger:** every basis and cited source, with checkable flags. No verdicts.
- **Questions / Updates / Credences:** the ledgers as timelines.
- **Steelman Arena:** each steelman report beside the steelmanned participant's store, showing captured, missed and distorted items and confirmation.
- **Worldview Fingerprints:** the strata distribution and Ontography dimension positions per participant (canonical, inferred-labeled).

**Also:**
- Search across transcript, propositions and concepts.
- Share: copy a link to the moment, proposition, crux or lens state.
- Export: bundle JSON (DT-compatible subset), a markdown report, and map images at print resolution.

## 8. Setup (`/setup/:event`)

1. Event, format template, and rounds (editable timings).
2. Participants: name, role, color, channel.
3. Audio: channel meter per input; bleed test ("A, speak; B, stay silent"). Sets the gate threshold.
4. **Voice enrollment:** 30 s per participant, with a quality meter.
5. Priors (optional): ingest participants' writing → inferred fingerprints (the Ontography lineage).
6. Topic landscape and facilitator briefing (optional, operator-reviewed).
7. Output devices: pair the cockpit, stage and overlay via per-role links or QR codes. Set the default dial per channel.
8. A dry run with the fixture replay to confirm every device renders.

## 9. Participant review (post-event)
Each participant gets a private link to their own commitment store, with spans. For each item: confirm, amend (with their wording, kept alongside the canonical text), or contest. Their confirmations flow into the playback's status layer.
