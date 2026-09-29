# R0 demo (Fri 2026-10-02): one live pipeline, any debate

**Goal.** Stephanie opens a link and watches a real debate being mapped: the crux, higher ground, shared ground and facilitator prompts appear as the conversation unfolds, and an arc view shows the Anti-Debate pattern (difference clarified in phase 1, synthesis explored in phase 2). Nothing is hardcoded. The same pipeline runs a live room and any recorded debate, and a recording replayed at 1× is the proof that live works.

## Architecture

```
                    ┌──────────────── Neon Postgres: events (append-only) ───────────────┐
 live mics ─▶ capture (py) ─POST /api/events─▶│ utterance.final …                               │
 recording ─▶ fetch → FluidAudio → feeder ───▶│ (same events, stamped at wall time)              │
                                              │                                                  │
 worker `run` (operator Mac) ◀── tail ────────┤ turns → L1 extract → L2 critic → auto-approve   │
                              ── append ─────▶│ round.started · insight.proposed (L4, periodic) │
                                              └──────────────────────────────────────────────────┘
 web (Vercel) ◀── SSE /api/events/stream (poll the log) ── cockpit · arc · console · sessions
 web ── POST /api/events ──▶ operator actions (approve / reject / send / round / dial)
```

- **One event log.** Everything is an event in Neon (`packages/db`). Without `DATABASE_URL` the worker writes `.data/<session>.events.jsonl`, and the web app reads that locally.
- **The worker is the only process that calls the model.** It runs on the operator's Mac (as on the day). The web app never calls Claude.
- **Replay is the live path.** The feeder appends `utterance.final` events at 1×, N× or max speed with wall-clock `wallTs`, and the pipeline tails the log exactly as it would during a live session.

## Session ids

`<slug>-<yyyymmdd-hhmm>`, e.g. `ball-kokotajlo-20260930-1400`. Every event id is prefixed with the session id, so reruns never collide.

## Events the UI reads (packages/core/src/events.ts)

| Event | Meaning for the UI |
|---|---|
| `session.started` | title, format id, participants (key, displayName, role), `seats` (aff/neg/moderator), `source` (live/recording) |
| `round.started` / `round.ended` | `roundId` from `packages/core/src/formats.ts` (`ANTI_DEBATE.rounds`), name, `mediaMs` |
| `utterance.final` | transcript line: `participantKey`, `startMs`, `endMs`, `text` |
| `adu.proposed` | argumentative unit: speech act, verbatim `spans[].quote` |
| `proposition.proposed` | canonical claim, type, stratum, scope |
| `stance.proposed` | participant × proposition: attitude, strength, `source` (`implied_by_act` = concession or rhetorical question) |
| `relation.proposed` | supports / rebuts / undercuts / … between propositions |
| `validation.result` / `critic.verdict` | quality badges on an item |
| `item.approved` / `item.rejected` / `item.sent_to_facilitator` | operator (or auto-approval rule) decisions |
| `insight.proposed` | `insight.kind` ∈ `crux`, `higher_ground`, `prompt`, `shared`; `insight.body` per `packages/ontology/src/insights.ts` |

Projection: `project(sessionId, events)` → `SessionState` (`packages/core/src/state.ts`). Disagreements and common ground: `commitmentStores` / `disagreements` / `commonGround` (`packages/graph`). The newest insight of each kind is "now". Earlier ones are history, which is the arc view's raw material.

## Cockpit visibility rule

The cockpit shows an insight when it is `approved` (auto-approval: validators clean + critic pass) or `sentToFacilitator`. Rejected items never show. Audience routes (`/stage`) still get `audienceView()` only.

## Surfaces (apps/web)

| Route | For | Content |
|---|---|---|
| `/` | everyone | Sessions (live now, recorded), link to start a new one |
| `/s/[session]/cockpit` | facilitator | UX §3 Glance: crux · higher ground · shared · try asking; ledger strip; round + clock |
| `/s/[session]/arc` | Stephanie, audiences after the fact | The Anti-Debate pattern over time: phases and rounds, per-side claims, disagreements opening and closing, shared ground and higher ground accumulating; scrubber + transcript |
| `/s/[session]/console` | operator | Transcript with attribution, extraction queue with badges, approve / reject / send, round control |
| `/new` | operator | Start a live session, or queue a recording by URL (the worker picks it up) |

## Worker commands (apps/worker)

```bash
pnpm --filter @adl/worker run:session -- --fixture ball-kokotajlo-ai-governance --speed 1   # replay through the live path
pnpm --filter @adl/worker run:session -- --live --session <id>                             # tail a live session
pnpm --filter @adl/worker ingest -- --url https://youtu.be/… --slug <slug>                 # fetch + transcribe + propose speakers
```
