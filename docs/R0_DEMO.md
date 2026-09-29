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

## Runbook

Deployed: **https://antidebate.xyz** (also https://antidebate-live.vercel.app; reads Neon). DNS: Namecheap → Vercel nameservers (ns1/ns2.vercel-dns.com). Locally: `pnpm dev` → http://localhost:3000 (reads Neon if `apps/web/.env.local` has `DATABASE_URL`, else `.data/`).

### A. Replay a recorded debate through the live path
```bash
# straight into Neon, at real-time pace: open /s/<session>/cockpit and /arc while it runs
pnpm --filter @adl/worker run:session -- --fixture ball-kokotajlo-ai-governance --session bk-live-demo --speed 1
# a quick look: 15 minutes at 4×
pnpm --filter @adl/worker run:session -- --fixture ball-kokotajlo-ai-governance --speed 4 --from 20 --to 35
# a local-file run, then publish it
pnpm --filter @adl/worker run:session -- --fixture … --session … --file && pnpm --filter @adl/worker push -- --session …
```

### B. Any other recording
```bash
pnpm --filter @adl/worker ingest -- --url https://www.youtube.com/watch?v=… --slug my-debate
# check the proposed speakers printed (and in fixtures/antidebate/my-debate/manifest.json), then
pnpm --filter @adl/worker ingest -- --slug my-debate --confirm
pnpm --filter @adl/worker run:session -- --fixture my-debate --speed 1
```
If the video opens with a teaser, set `programStartMs` in the manifest.

### C. Live room (one mic channel per person)
```bash
cd services/capture && uv sync --extra mac --extra live
uv run python -m adl_capture.live --list-devices                  # find the interface
# terminal 1: the pipeline for the session (creates session.started)
pnpm --filter @adl/worker run:session -- --live --session room-test-1 --title "Room test" \
  --format anti-debate --debaters "A=Person One:aff,B=Person Two:neg" --moderator "MOD=Moderator"
# terminal 2: capture, posting to the deployed API (CAPTURE_TOKEN from .env)
set -a; source ../../.env; set +a
uv run python -m adl_capture.live --session room-test-1 --channels "1=A,2=B,3=MOD" --device <n> --api https://antidebate-live.vercel.app
```
Solo smoke test with the laptop mic: `--channels "1=A"`, speak as A. A single speaker produces claims, but no disagreement or crux.
Ctrl-C the worker to close the session. Rerun it with `--live --session <id>` and it resumes from the log.

### Costs (measured 2026-09-28)
About $1.6 per 11 minutes of two-person debate (L1+L2 per turn, L3+L4 every ~4 turns), or ~$12–15 for a 90-minute event.

### Event-day checklist (added 2026-09-29)
- Neon: set the compute's autosuspend to "never" for the event window (cold start ~5 s otherwise), then back after.
- Warm the deployment and database: open the cockpit and console once 15 minutes before doors.
- Operator key: open `/?key=<OPERATOR_KEY>` once on the console laptop; the cockpit iPad needs no key (read-only).
- Hosts (Stephanie, Liv): sign in at `/host`, connect an Anthropic key with $25 of credit, and run **Prepare this laptop** on the event laptop the day before, on good Wi-Fi. See [HOSTING.md](./HOSTING.md).
- Live in the browser (host flow, see [HOSTING.md](./HOSTING.md)): the day before, run **Prepare this laptop** and do a full rehearsal with the same interface and mics. At the sound check, do the interface and mic check (each input's meter moves for its own speaker only; if both meters move together, it is a mixed signal, use One mic in the room), then enrollment: about 20 seconds from each person, in the room, on their own mic. Keep the laptop plugged in with sleep off and the tab in front. Open the map and cockpit from the links on the live page (they open in a new tab so capture keeps running).
- Manual checks before the event (full steps and pass criteria in [HOSTING.md](./HOSTING.md), "Before your event"): the Scarlett L/R split in Chrome, two USB mics for 90 minutes with no drift above 100 ms (clap at the start and the end), Chrome system audio on the host's macOS, the speed test on the host laptop (2× real time or better for live), and a full 10-minute rehearsal on Stephanie's laptop.
- Browser transcription, measured 2026-09-29 (evals/results.md, "Browser ASR accuracy"): on five 60 s windows of Ball × Kokotajlo the int8 WASM build differed from the native Parakeet transcript by 7.2% of words on average per window (7.1% pooled over words; 2.8% to 18.5% by window), at about 10× real time (headless Chromium, M-series, 2026-09-29), with 6:00 the worst window because it lost words; production chunking loses them too (evals/results.md). That reference is the same model family, not a human transcript.
