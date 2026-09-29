# antidebate-live

**Real-time mapping for facilitated disagreement.** Rigorous, quote-anchored claim extraction; crux and higher-ground detection; a facilitator cockpit; an audience detail dial; a 3D argument topology; and full playback.

By **Benjamin Life** ([@omniharmonic](https://github.com/omniharmonic)). The live successor to [Dialectical Topology](https://github.com/omniharmonic/dialecticaltopology), building on [Ontography](https://github.com/omniharmonic/auto-ontography-archive).

**First deployment:** the Anti-Debate at Progress Conference, Lighthaven (Berkeley), **Sun 2026-10-11, 2:00–3:30pm**, facilitated by Stephanie Lepp.

## Start here
0. [`docs/HANDOFF.md`](docs/HANDOFF.md): **new agent? start here**
1. [`docs/README.md`](docs/README.md): decisions and the doc index (PRD, Ontology, Architecture, UX, Quality, Implementation Plan, Reuse Audit)
2. [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md): what to do right now, in order
3. [`docs/client/`](docs/client/): Stephanie's feedback and the prior debates to replay
4. [`AGENTS.md`](AGENTS.md): repo rules for coding agents (and humans)

## Quick start
```bash
pnpm install
cp .env.example .env        # ANTHROPIC_API_KEY for --llm; DATABASE_URL optional locally
pnpm check                  # typecheck + tests
pnpm replay:dt              # replay the Marcus × Demartini fixture into .data/
pnpm dev                    # http://localhost:3000 → /play/dt
```

## Status (2026-09-29)
Live: **https://antidebate.xyz** (also antidebate-live.vercel.app; Neon event log). Demo session: `ball-kokotajlo-r5`.

| Area | State |
|---|---|
| Pipeline | Rounds → L1 extract → L2 critic + auto-approval → L3 link → L4 insight (crux, higher ground, prompts, shared/converging), all code-validated; one engine for live rooms and replays (`run:session`) |
| Cost | Default provider is the Claude **subscription** (headless Claude Code, $0 API); the API needs `LLM_PROVIDER=api` + `LLM_API_BUDGET_USD`; every response is cached |
| Library | All six playlist recordings ingested (`ingest`), transcribed and diarized locally (FluidAudio), and run through the full pipeline; `diagnose` per run; graded in `evals/results.md` (Ball × Kokotajlo higher-ground recall 4/4, then ≥3/4 on the latest run) |
| Web | Sessions, Explore (4D Spatial / Timeline / Positions), Facilitate (cockpit), Operate (console), `/new`; Section design; writes need a key |
| Capture | Offline (FluidAudio) ✅; live loop `live.py` (per-person mics → Parakeet) tested on synthetic and recorded audio; **not yet tried with real mics** |
| Evals | Hand-graded runs and diagnostics; human gold sets still to build |

See `docs/NEXT_STEPS.md` §0 and `docs/R0_DEMO.md` (runbook).
