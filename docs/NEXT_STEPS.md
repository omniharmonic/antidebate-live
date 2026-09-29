# Next steps (updated Mon 2026-09-28, first local session)

Ordered by the critical path in [IMPLEMENTATION_PLAN §4](./IMPLEMENTATION_PLAN.md). Check items off in PRs.

## 0. The long-running build loop (Benjamin, 2026-09-28). Work through in order in one session
1. [ ] **Ingest loop** over every playlist debate (subscription only, $0 API): run the full pipeline → `diagnose` → write the findings and an improvement plan in `evals/results.md` → implement → verify on the next ingest.
   - [x] Ball × Kokotajlo (r1 on Opus/API, stopped at 80m; r2 on Sonnet, full)
   - [x] Gender-Affirming Care (gac-r1)
   - [ ] Belief in God (belief-in-god-r1). Running
   - [ ] Destiny × Shermer (co-moderated)
   - [ ] Open-Source AI (co-moderated, ~2h15)
   - [ ] Ignite talk (one-speaker edge case)
2. [ ] **Frontend UX pass**, plus new form factors: a 4D view (3D agreement/disagreement/depth space across time) and anything else that makes the output compelling for audiences and moderators.
3. [ ] **Comprehensive end-to-end testing loop(s)** across ALL ingested sessions and their results, for high-quality multi-dimensional insights and stunning visualizations. Several evaluate → fix → re-verify iterations: rerun sessions with the final pipeline, check every surface (cockpit, arc, 4D, console) on every session in a browser, and grade insight quality against the references. Only then wrap the session.

## A. In a LOCAL Claude Code session (needs network access the cloud container lacks)
1. ✅ **Read the Anti-Debate how-to guide** (shorter and longer versions): https://www.anti-debate.org/how-to-guide.html
   → Saved as `docs/client/anti-debate-how-to-guide.md`. **Still to do:** encode the rounds as the Anti-Debate template (PRD §7) in `packages/core/src/formats.ts`.
2. ✅ **Read the prior-debate write-ups** in [client/prior-debates.md](./client/prior-debates.md): the Synthesis Media post, Jasmine Li's Lighthaven notes, the EA Forum post. Done: `docs/client/ball-kokotajlo-reference.md`. The "transparency" item was not a stated convergence and was replaced; the list now has 4 verified items, plus 5 reference cruxes. QUALITY §4 higher-ground recall gate updated to ≥ 3 of 4.
3. ✅ **Fetch the Dean × Daniel audio:** `tools/fetch-replays.sh --playlist` (runs the latest yt-dlp via `uvx` with browser impersonation; plain yt-dlp gets HTTP 403). **Still to do:** choose 2 more events for G3 from `fixtures/antidebate/playlist.txt` (suggested: Open-Source AI, The Value of Belief in God) and add manifests.
4. ✅ **Offline transcript** (Apple Silicon, no HF token): `cd services/capture && uv run python -m adl_capture.offline ../../fixtures/antidebate/ball-kokotajlo-ai-governance` (FluidAudio). `speakerMap` filled from transcript self-identification and confirmed by Benjamin. One known misattribution at ~44:54; fast handovers need a relabel pass.
5. ✅ `pnpm --filter @adl/worker replay -- --fixture ball-kokotajlo-ai-governance --out ../../.data/ball-kokotajlo-ai-governance.events.jsonl`

## B. Accounts and secrets (Benjamin)
- [x] `ANTHROPIC_API_KEY` in `.env` (and in the cloud environment's secrets for cloud sessions)
- [ ] Neon project → `DATABASE_URL`; then `pnpm db:push`
- [ ] Vercel project for `apps/web` (root directory `apps/web`)
- [ ] `ROLE_LINK_SECRET` (random string)
- [ ] Optional: `DEEPGRAM_API_KEY` (hosted ASR fallback). `HF_TOKEN` is no longer needed; diarization runs on FluidAudio.

## C. Build (see docs/R0_DEMO.md for the demo architecture)
- [x] **WS2:** L1 extract v0.3 (rhetorical questions as implied statements), graded runs in `evals/results.md`
- [x] **WS2:** L2 critic (`l2-critic-v0.2`) + the auto-approval rule (`packages/pipeline/src/l2.ts`)
- [x] **WS2:** round detection from moderator turns against `formats.ts` (`rounds.ts`)
- [x] **WS2:** L3 link (identity merges incl. negated duplicates, inferred cross-speaker relations) and L4 insight (crux / higher ground / prompts / shared), all code-validated
- [x] **WS3:** session engine: one loop for live and replay (`apps/worker/src/engine.ts`, `run:session`), Neon or JSONL log, per-call cost logging
- [x] **WS1:** `live.py`: per-person mic channels → gate → segmenter → Parakeet (MLX) → `utterance.final` via POST /api/events (tested on synthetic frames and real audio; **not yet run with real mics**)
- [x] Ingest any recorded debate: `pnpm --filter @adl/worker ingest -- --url … --slug …` (fetch, FluidAudio, model-proposed speakers, operator `--confirm`)
- [x] Neon project `antidebate-live` (schema pushed); Vercel project `antidebate-live` (root `apps/web`; `DATABASE_URL`, `CAPTURE_TOKEN` set)
- [ ] **WS4:** web surfaces: sessions, cockpit, arc (the Anti-Debate pattern), console, /new. In progress
- [ ] Full Dean × Daniel run (`ball-kokotajlo-r1`), push to Neon, deploy, and send Stephanie the link (**R0 Fri 10/2**)
- [ ] Mic test in a room: two people, two mics → `live.py` → deployed cockpit (M2, 10/6)
- [ ] **WS2:** gold-set tooling in `evals/` (G1 DT, G2 Ball × Kokotajlo); critic precision measured against human judgment
- [ ] Worker job queue so `/new` can start recordings from the web
- [ ] **WS5:** 3D topology (after R0)

## D. People (Benjamin)
- [ ] Stephanie: Oct 11 debaters, topic, consent; who moderates; R0 review slot (10/3–10/5); rehearsal slot (10/9–10/10)
- [ ] Progress Conference AV contact: separate mic outs or bring lavs; a recording feed
- [ ] Hardware: 4-channel USB interface, lav mics, iPad (cockpit), stage laptop, hotspot
