# antidebate-live — documentation set

**Repo:** `omniharmonic/antidebate-live` (product working name: Topology Live, the live successor to Dialectical Topology).
**Author:** Benjamin Life ([@omniharmonic](https://github.com/omniharmonic)) · **Status:** Build-ready draft · **Updated:** 2026-09-28
**First deployment:** The Anti-Debate at Progress Conference, Lighthaven (Berkeley), **Sunday 2026-10-11, 2:00–3:30pm**, facilitated by Stephanie Lepp.

Topology Live is a general-purpose instrument for facilitated disagreement. It listens to a live debate. It builds a rigorous, quote-anchored map of what each person asserts, how they know it, what it presupposes, where they actually disagree, and what they could both stand on. It gives the facilitator a cockpit. It gives the audience whatever level of detail the facilitator chooses. After the event, it becomes a playback explorer where anyone can watch the recording with the whole map moving in sync.

## Documents

| Doc | What it settles |
|---|---|
| [PRD.md](./PRD.md) | Vision, users, surfaces, full feature set, the audience detail dial, release scope, success metrics |
| [ONTOLOGY.md](./ONTOLOGY.md) | The formal argument and epistemic model: what a claim is, how it is typed, grounded, related, and compared. Crux and higher-ground definitions. Faithfulness rules. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Capture and diarization, the multi-pass extraction pipeline, event sourcing, real-time delivery, playback, rendering, data model, infrastructure, cost |
| [UX.md](./UX.md) | Every surface in detail: facilitator cockpit, operator console, stage and livestream outputs, audience phones, 3D topology, lenses, playback. Design language and anti-slop rules. |
| [QUALITY.md](./QUALITY.md) | How we know the map is right: gold sets, annotation protocol, metrics, release gates, red-teaming |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | Milestones from today to Oct 11 and beyond, workstreams, acceptance criteria, event-day runbook |
| [REUSE_AUDIT.md](./REUSE_AUDIT.md) | What comes from Ontography and Dialectical Topology, what is built fresh, and the new repo's layout |
| [HANDOFF.md](./HANDOFF.md) | Onboarding for the next build agent: state, first steps, gotchas, rules |
| [NEXT_STEPS.md](./NEXT_STEPS.md) | What to do right now, in order |
| [client/](./client/) | Stephanie's feedback (verbatim) and the prior Anti-Debates to replay |

The earlier exploratory plan ([history/2026-09-25-exploratory-plan.md](./history/2026-09-25-exploratory-plan.md)) and the proposal page ([history/2026-09-25-proposal-page.html](./history/2026-09-25-proposal-page.html)) are superseded by this set.

## Decisions already made

| # | Decision | Why |
|---|---|---|
| D1 | **Stephanie's answers are the defaults for her event, not the product ceiling.** For Oct 11: audience level 0 ("dark"), debaters see nothing, in person. Every other capability exists and is one control away. | She set a baseline. The product serves any facilitator and any format. |
| D2 | **The facilitator controls audience exposure with a detail dial (levels 0–5) plus per-module toggles, per output channel.** | Her "clear no" is a muddled room. Exposure must be deliberate and reversible, second by second. |
| D3 | **Everything is event-sourced.** Every transcript line, extraction, operator decision and visibility change is an append-only event with a media timestamp. | Playback, audit, undo, "as seen live" versus "canonical", and debugging all come from one mechanism. |
| D4 | **Two speeds of truth.** A *live* pass (fast, provisional, operator-gated) and a *canonical* pass (post-event, full context, maximum rigor). Playback shows canonical by default and can show what the room saw live. | Real-time output can't be as good as hindsight. Being honest about that is part of the quality bar. |
| D5 | **Propositions are speaker-independent; stances are per speaker.** Disagreement is defined over shared propositions. | This is what makes "where exactly do they disagree" computable instead of vibes. See ONTOLOGY §2. |
| D6 | **Every mapped item is anchored to verbatim spans with word-level timestamps and passes automated faithfulness checks plus an independent critic pass.** | For a moderator trained in game theory, one sloppy paraphrase discredits the whole map. |
| D7 | **New repo**, TypeScript monorepo (Next.js 16 web, Node pipeline worker) plus a Python capture service. Claude Opus 5.5 through the Anthropic SDK for all reasoning passes. | Covered in ARCHITECTURE and REUSE_AUDIT. |
| D8 | **Stephanie's replay request is Milestone 1.** The Dean Ball × Daniel Kokotajlo Anti-Debate runs through the pipeline, and she reviews it before we build the live layer further. | "We need to try it before we know all the answers." |

## Open items that block nothing but matter

1. The Anti-Debate how-to guide ([anti-debate.org/how-to-guide.html](https://www.anti-debate.org/how-to-guide.html)) is blocked from the cloud build environment. Paste its text, or allow the host, so the round templates in PRD §7 can be finalized.
2. Oct 11 debaters, topic, and their consent to live mapping and a published playback.
3. The Progress Conference AV contact: mic channel access, a recording feed, and projector availability (even if unused at level 0).
4. Who operates the console on the day (Benjamin by default).
