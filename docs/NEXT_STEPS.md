# Next steps (as of Mon 2026-09-28)

Ordered by the critical path in [IMPLEMENTATION_PLAN §4](./IMPLEMENTATION_PLAN.md). Check items off in PRs.

## A. In a LOCAL Claude Code session (needs network access the cloud container lacks)
1. **Read the Anti-Debate how-to guide** (shorter and longer versions): https://www.anti-debate.org/how-to-guide.html
   → Save it as `docs/client/anti-debate-how-to-guide.md` (quote the source, keep attribution to Synthesis Media), then encode the rounds as the Anti-Debate template (PRD §7). Put the template data in `packages/core/src/formats.ts` (to create).
2. **Read the prior-debate write-ups** in [client/prior-debates.md](./client/prior-debates.md): the Synthesis Media post, Jasmine Li's Lighthaven notes, the EA Forum post. Verify the "published synthesis" list against them, then set `reference.verified` in the manifest.
3. **Fetch the Dean × Daniel audio:** `brew install yt-dlp ffmpeg && tools/fetch-replays.sh --playlist`. Choose 2 more events for G3 from `fixtures/antidebate/playlist.txt` and add manifests.
4. **Offline transcript** (Apple Silicon): `cd services/capture && uv sync --extra mac --extra diarize && HF_TOKEN=… uv run python -m adl_capture.offline ../../fixtures/antidebate/ball-kokotajlo-ai-governance`. Fill `speakerMap` in the manifest after listening to a few lines per label.
5. `pnpm --filter @adl/worker replay -- --fixture ball-kokotajlo-ai-governance --out ../../.data/ball-kokotajlo-ai-governance.events.jsonl`

## B. Accounts and secrets (Benjamin)
- [ ] `ANTHROPIC_API_KEY` in `.env` (and in the cloud environment's secrets for cloud sessions)
- [ ] Neon project → `DATABASE_URL`; then `pnpm db:push`
- [ ] Vercel project for `apps/web` (root directory `apps/web`)
- [ ] `ROLE_LINK_SECRET` (random string)
- [ ] Optional: `HF_TOKEN` (pyannote), `DEEPGRAM_API_KEY` (hosted ASR fallback)

## C. Build (workstreams in IMPLEMENTATION_PLAN §3)
- [ ] **WS2:** first real L1 run: `pnpm --filter @adl/worker extract -- --fixture dt --turns 12 --skip 20 --llm`; inspect `.data/dt.l1.events.jsonl`; iterate the prompt in `packages/pipeline/src/prompts/l1-extract.ts`
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
