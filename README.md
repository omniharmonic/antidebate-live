# antidebate-live

**Real-time mapping for facilitated disagreement.** Rigorous, quote-anchored claim extraction; crux and higher-ground detection; a facilitator cockpit; an audience detail dial; a 3D argument topology; and full playback.

By **Benjamin Life** ([@omniharmonic](https://github.com/omniharmonic)). The live successor to [Dialectical Topology](https://github.com/omniharmonic/dialecticaltopology), building on [Ontography](https://github.com/omniharmonic/auto-ontography-archive).

**First deployment:** the Anti-Debate at Progress Conference, Lighthaven (Berkeley), **Sun 2026-10-11, 2:00–3:30pm**, facilitated by Stephanie Lepp.

## Start here
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

## Status (2026-09-28)
| Area | State |
|---|---|
| Docs | Complete v1 |
| Ontology schemas + validators | ✅ with tests |
| Event log, projections, snapshots, audience filter | ✅ with tests |
| Crux ranking, commitment stores | ✅ with tests |
| L0 turns, L1 extraction (prompt, mapper, validators) | ✅ mapper tested; **L1 not yet run against the API** |
| Web: playback skeleton, stage skeleton, SSE, ingest API | ✅ builds; cockpit, console and setup not built |
| Capture: gate, fusion, merge, emit, offline | ✅ pure parts tested; offline needs a Mac run; live loop not built |
| Evals / gold sets | not started (WS2) |
