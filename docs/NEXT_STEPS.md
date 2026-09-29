# Next steps (updated Mon 2026-09-28, first local session)

Ordered by the critical path in [IMPLEMENTATION_PLAN §4](./IMPLEMENTATION_PLAN.md). Check items off in PRs.

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

## C. Build (workstreams in IMPLEMENTATION_PLAN §3)
- [x] **WS2:** first real L1 run (v0.1 → v0.2; see `evals/results.md`): `pnpm --filter @adl/worker extract -- --fixture dt --turns 12 --skip 20 --llm`; inspect `.data/dt.l1.events.jsonl`; iterate the prompt in `packages/pipeline/src/prompts/l1-extract.ts`
- [ ] **WS2:** L2 critic pass (independent prompt, ONTOLOGY §8 rubric) → `critic.verdict` events
- [ ] **WS2:** gold-set tooling in `evals/`: annotate 12-minute segments (G1 from DT now, G2 once fetched)
- [ ] **WS3:** worker live loop (tail events → TurnBuffer → L1/L2 → append); snapshots every 200 events
- [ ] **WS4:** cockpit replay simulation for Stephanie (**R0 due Fri 10/2**)
- [ ] **WS1:** live capture loop on the operator Mac (`services/capture/adl_capture/live.py`)
- [ ] **WS5:** deterministic stratified 3D topology on replay data

## D. People (Benjamin)
- [ ] Stephanie: Oct 11 debaters, topic, consent; who moderates; R0 review slot (10/3–10/5); rehearsal slot (10/9–10/10)
- [ ] Progress Conference AV contact: separate mic outs or bring lavs; a recording feed
- [ ] Hardware: 4-channel USB interface, lav mics, iPad (cockpit), stage laptop, hotspot
