# Topology Live — Implementation Plan

**Author:** Benjamin Life (@omniharmonic) · **Version:** 1.0 · **Date:** 2026-09-28 (Mon)
**Hard date:** Sunday 2026-10-11, 2:00–3:30pm, Progress Conference, Lighthaven, Berkeley.

---

## 1. Strategy

Thirteen days is enough for an excellent, focused live edition. It isn't enough for the full vision. The plan protects three things:

1. **Quality before breadth.** The live edition ships only modules that pass their gates (QUALITY §6). Everything else runs operator-only and appears in playback after the canonical pass.
2. **Replay first.** Every component is built and tuned against recorded debates before it meets a live room. That also answers Stephanie's request to "try it before we know all the answers".
3. **One event log.** Built on day 1, so playback, audit and debugging need no rework.

Work runs as **five parallel workstreams**, each suited to its own Claude Code session, all merging into the new repo daily. Benjamin is product owner, annotator and operator.

## 2. Milestones

| ID | Date | Milestone | Exit criteria |
|---|---|---|---|
| M0 | Tue 9/29 | Repo live; ontology schemas; event log; fixture replay feeding events | `pnpm replay fixtures/dt` produces utterance events in the DB and a projection test passes |
| M1 | Fri 10/2 | **R0: replay of Dean × Daniel for Stephanie** | L1–L4 run on the full event (offline transcript + relabel); a replay page for Stephanie with a cockpit simulation and levels 2–4 over time; R0 gate met |
| M2 | Tue 10/6 | Live capture in a room; console + cockpit on the live stream | Two people with two mics → attributed utterances ≤ 1.5 s; G5 swap test passes; the cockpit renders operator-sent insights |
| M3 | Thu 10/8 | **Feature freeze** (conference starts). Stage output + dial; 90-minute soak | R1 gates met on held-out sets; soak passes; every device paired |
| M4 | Fri 10/9–Sat 10/10 | Rehearsal with Stephanie; venue AV check | Stephanie runs a 15-minute mock with two volunteers; the channel map is confirmed with Lighthaven AV |
| **M5** | **Sun 10/11** | **Live event** | PRD §9 Oct 11 metrics |
| M6 | Sun 10/25 | **R2: canonical pass + playback explorer + participant review** | Playback published after review; 3D topology + core lenses |
| M7 | Nov | R3: remote/hybrid, overlay, phones, polls, full lenses, priors, multi-event library | Second event run on the platform |

## 3. Workstreams

### WS1 Capture & attribution (Python) — `services/capture`
| Day | Deliverable |
|---|---|
| 9/29 | Multichannel input + continuous multitrack recording + VAD; utterance events to the API with a local queue |
| 9/30 | Parakeet (parakeet-mlx) with word timestamps; hosted multichannel ASR fallback behind a flag |
| 10/1 | Channel gate (bleed/overlap); enrollment + voiceprint scoring; fusion + `attribution.pending` |
| 10/2 | **Offline path:** downloaded audio → Parakeet + pyannote → relabel file → events (feeds M1) |
| 10/3–10/5 | Diarization bake-off on G5 + replays (FluidAudio as an R3 candidate); tune thresholds; shared-channel diarization for the audience mic |
| 10/6 | Live-room test (M2) |
| 10/7 | Failure drills: unplug the network, kill a process, swap the ASR engine mid-session |

### WS2 Ontology, pipeline & evals (TS) — `packages/ontology`, `packages/pipeline`, `evals`
| Day | Deliverable |
|---|---|
| 9/28–9/29 | Zod schemas for every ONTOLOGY entity; validators (spans, entities/numbers, hedges, quantifiers, speech-act guard); prompt modules with versions |
| 9/29–9/30 | L1 segment & extract + L2 critic on G1; the first gold segments (model-drafted, human-corrected; §5 risk) |
| 10/1 | L3 linking (identity resolution, relations, presuppositions with the necessity test, senses) |
| 10/1–10/2 | L4 insight (crux ranking in code + cards, higher ground by construction, prompts from critical questions, drift, steelman, updates, questions). **Full Dean × Daniel run → M1** |
| 10/3–10/7 | Eval harness + held-out scoring; prompt iteration against the gates; latency and effort tuning; cost measurement |

### WS3 Event log, API & real-time (TS) — `packages/core`, `apps/worker`, `apps/web/api`
| Day | Deliverable |
|---|---|
| 9/28–9/29 | Events table, idempotent append, projections (pure reducers) + tests, snapshots |
| 9/30 | Worker process: turn buffer, pass scheduler, back-pressure, `llm_calls` logging with cache metrics |
| 10/1 | SSE stream with per-view server-side filtering (audience channels receive release-derived payloads only); role links |
| 10/2 | The replay feeder at 1×/4×/max, driving the same stream as live |
| 10/5 | Operator actions (approve / edit / merge / reject / send / release / retract / blackout / spotlight / dial) as events |

### WS4 Cockpit, console & stage (TS/React) — `apps/web`
| Day | Deliverable |
|---|---|
| 9/30 | Design tokens (Open Field + stage dark); the component kit (proposition card with epistemic encodings, stance glyphs, span viewer) |
| 10/1–10/2 | Cockpit Glance mode + a replay simulation page for Stephanie (M1) |
| 10/3–10/5 | Operator console (transcript with attribution hotkeys, extraction queue with badges, insight queue, health strip, outputs panel) |
| 10/5–10/7 | Stage output levels 0–4 (2D map), dial sheet, Reveal / Blackout / Spotlight; Break and Judge modes in the cockpit |

### WS5 Topology 3D & playback (TS/R3F) — `packages/topology3d`, `apps/web/play`
| Day | Deliverable |
|---|---|
| 10/1–10/4 | Deterministic stratified 3D layout, encodings, fault planes, higher-ground filaments, interaction; runs on replay data |
| 10/5–10/7 | Cinematic stage mode + an fps guard with 2D fallback. **Enabled on stage on 10/11 only if it passes the stability gate and the facilitator wants it.** |
| 10/12–10/25 | Playback: media sync, seek via snapshots, canonical vs as-seen-live, lenses (Map, Positions Matrix, Crux Tree, Flow, Questions, Updates), deep links, export, participant review |

## 4. Critical path and dependencies

```
9/28 schemas ─▶ 9/29 event log ─▶ 9/30 L1+critic ─▶ 10/1 L3 ─▶ 10/2 L4 + Dean×Daniel transcript ─▶ M1 (Stephanie reviews 10/3–10/5)
                          │                                            ▲
                          └─▶ 10/1 SSE ─▶ 10/2 replay feeder ──────────┘
9/29 capture ─▶ 10/1 gate+voiceprints ─▶ 10/6 live room (M2) ─▶ 10/8 soak (M3) ─▶ 10/10 rehearsal ─▶ 10/11
```

**Blocking inputs needed from outside:**
| Need | From | By |
|---|---|---|
| Dean × Daniel audio (and other playlist videos) | Benjamin downloads locally, or allows youtube.com / googlevideo.com in the cloud environment's network settings | 9/30 |
| The Anti-Debate how-to guide text | Paste it, or allow anti-debate.org | 9/30 |
| Oct 11 debaters, topic, consent | Stephanie | 10/2 |
| AV contact at Progress Conference / Lighthaven: separate mic outs or our own lavs, recording feed | Benjamin → organizers | 10/2 |
| Hardware: 4-channel USB audio interface, 3–4 lav mics as backup, iPad for the cockpit, stage laptop, hotspot | Benjamin | 10/5 |
| Anthropic API key with sufficient rate limits; Neon project; Vercel project | Benjamin | 9/28 |

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gold annotation bottleneck (Benjamin's time) | High | Model-drafted annotations corrected by a human for development sets; independent human-only annotation for the **held-out** segments to avoid circularity; recruit a second annotator |
| L1 latency above target at the needed quality | Medium | Effort sweep; turn-window tuning; parallelize L1 per ADU; the operator sees raw transcript instantly regardless |
| Venue AV won't provide separate channels | Medium | Bring our own lavs + interface; the moderator wears one too |
| Conference Wi-Fi congestion | High | Dedicated hotspot for the operator laptop and cockpit; capture records locally regardless |
| Format details unknown until the guide is read | Low | Rounds are data; confirm with Stephanie at M1 review |
| 3D stage mode unstable | Medium | Stephanie's default is level 0; 3D is additive; 2D fallback |
| Scope creep before 10/11 | High | The freeze on 10/8 is absolute; post-freeze changes are config and prompt fixes only, each re-run against held-out sets |
| Participant consent withheld for publication | Low–Medium | Live mapping for the facilitator still works; playback stays private |

## 6. Event-day runbook (Sun 10/11)

| Time | Step |
|---|---|
| 11:30 | Arrive. Network check (venue + hotspot). Power for every device. |
| 12:00 | Connect to venue mixer outs or rig lavs. Channel map in Setup. Level check. |
| 12:30 | Pair devices: cockpit (Stephanie's iPad), stage (dial at 0), console. Fixture replay dry run on all screens. |
| 13:15 | Sound check with participants: bleed test, 30 s voice enrollment each, speaker identity test. |
| 13:30 | Stephanie's 5-minute cockpit walkthrough: which quadrants, how Blackout and Spotlight work (even at level 0). |
| 13:50 | Start recording. Start the session. Confirm health is green. |
| 14:00–15:30 | Live. The operator confirms held lines within 5 s, approves the extraction queue, and sends the crux / higher ground / prompts at the cadence agreed with Stephanie (default: a new prompt at most every 3 minutes, and at every round break). |
| 15:30 | Stop the session. Keep recording until the room clears. Upload tracks. Start the canonical pass. |
| 15:45 | Five-minute debrief with Stephanie: the 1–5 ratings on clarity and distraction; what she used and what she ignored. |

**Emergency cards (printed):** capture down → hosted ASR switch; worker down → restart from the event log (≤ 20 s); network down → hotspot; wrong item on the cockpit → retract; anything on stage → Blackout.

## 7. After the event
- 10/12–10/14: canonical pass; operator review of reconciliation diffs; post-event audit (QUALITY §8).
- 10/15–10/21: participant review window.
- 10/25: playback published (with consent), retrospective, R3 planning.
