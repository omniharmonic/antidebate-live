# Handoff: picking up the antidebate-live build

**From:** the cloud setup session (2026-09-28) · **For:** the next build agent, running locally with full network access
**Owner:** Benjamin Life (@omniharmonic). Attribute all work to him; never to OpenCivics.

---

## 1. The job in one paragraph

Build a real-time mapping instrument for facilitated debate. Its first live use is **Stephanie Lepp's Anti-Debate at Progress Conference, Lighthaven (Berkeley), Sunday 2026-10-11, 2:00–3:30pm**. It listens to two debaters through separate mics and extracts a rigorous, quote-anchored argument map (propositions, stances, epistemic bases, relations). It surfaces the **crux**, **higher ground** and **facilitator prompts** in a calm cockpit on Stephanie's tablet. The audience sees nothing by default (dial level 0), but the dial can expose more. Everything is recorded as an event log, so a full playback explorer (3D topology, lenses) ships afterwards. The moderator has a game-theory background: extraction quality must be beyond reproach.

## 2. Read first (in this order, ~30 minutes)

1. `AGENTS.md`: repo rules and non-negotiables. `CLAUDE.md` imports it.
2. `docs/client/stephanie-feedback.md`: her requirements, verbatim
3. `docs/README.md`: decisions D1–D8
4. `docs/ONTOLOGY.md`: **binding**. Every schema, prompt and validator comes from it.
5. `docs/IMPLEMENTATION_PLAN.md`: dated milestones and workstreams
6. `docs/NEXT_STEPS.md`: the running checklist (keep it current)
7. Skim as needed: `ARCHITECTURE.md`, `UX.md`, `QUALITY.md`, `PRD.md`, `REUSE_AUDIT.md`

## 3. Current state (verified 2026-09-28, commit `be12069`)

| Area | State | Verified how |
|---|---|---|
| `packages/ontology` | Zod schemas for all entities; validators for spans, new content, hedges, scope, speech-act guard, attribution hold | 13 tests |
| `packages/core` | Typed event union, pure reducers, snapshots + `stateAt`, `audienceView` filter, fixture → events | 6 tests incl. DT replay determinism, snapshot seek equivalence, level-0/blackout audience safety |
| `packages/graph` | Commitment stores, disagreements, common ground, crux ranking, shortest path | 4 tests |
| `packages/pipeline` | L0 `TurnBuffer`, `locateQuote`, L1 prompt (`l1-extract-v0.1`), `mapL1Output`, `runL1` | 5 tests on the mapper with a hand-written model output |
| `packages/llm` | `callStructured`: Opus 5.5, per-pass effort, two cached system blocks, `zodOutputFormat`, `fallbacks: "default"`, log sink | **Typechecks only. Never called against the API.** |
| `packages/db` | Drizzle schema (events, snapshots, llm_calls), `appendEvents`, `readEvents` | Typechecks; **never run against Neon** |
| `apps/worker` | `replay` (fixture → JSONL/DB), `extract` (turns; `--llm` for L1) | replay produced 271 events; extract printed turns |
| `apps/web` | Next.js 16: `/` index, `/play/[event]` scrubber skeleton, `/stage/[channel]` level-0 skeleton, `/api/events/stream` SSE (local-file or DB tail), `POST /api/events` ingest | `next build` OK; the running app served `/play/dt` and both SSE views |
| `services/capture` | `gate`, `fusion`, `merge` (tested); `emit` (untested); `offline.py` (never run); `live.py` (not built) | 7 pytest |
| `evals/` | README only | none |
| Cockpit, console, setup, 3D, lenses | Not built | — |

## 4. Your first session: do these in order

### Step 0: environment (15 min)
```bash
pnpm install && pnpm check                 # expect 9/9 turbo tasks green
cp .env.example .env                       # add ANTHROPIC_API_KEY now; DATABASE_URL once Neon exists
cd services/capture && uv sync && uv run pytest -q && cd ../..
```

### Step 1: the network tasks the cloud session couldn't do
These are blocked in the cloud container, which is why you're running locally.
1. **Anti-Debate how-to guide** (shorter + longer): https://www.anti-debate.org/how-to-guide.html
   - Save a faithful summary with attribution in `docs/client/anti-debate-how-to-guide.md`.
   - Add the round template as data in `packages/core/src/formats.ts` (new): `{ id, name, plannedMs, speakingOrder, pipelineEmphasis, dialDefaultsAtBoundary }` per PRD §7.
   - Update PRD §7 and the `session.started` payload's `format` to reference it.
2. **Prior-debate write-ups** listed in `docs/client/prior-debates.md` (Synthesis Media post, Jasmine Li's notes, EA Forum). Verify the three "published synthesis" items; set `reference.verified: true` in `fixtures/antidebate/ball-kokotajlo-ai-governance/manifest.json` or correct the list.
3. **Media:** `brew install yt-dlp ffmpeg && tools/fetch-replays.sh --playlist`. Choose 2 more playlist events for G3 and add their `manifest.json`. **Media stays gitignored.**
4. **Offline transcript** (Apple Silicon): `cd services/capture && uv sync --extra mac --extra diarize && HF_TOKEN=… uv run python -m adl_capture.offline ../../fixtures/antidebate/ball-kokotajlo-ai-governance`
   - `offline.py` assumes parakeet-mlx result fields `result.sentences[].tokens[].{text,start,end}` and the pyannote 3.1 API. **Verify both against the installed versions** and fix them before trusting the output.
   - Then have Benjamin (or you, by listening) fill `speakerMap` in the manifest. No named attribution without that step.
   - `pnpm --filter @adl/worker replay -- --fixture ball-kokotajlo-ai-governance --out ../../.data/ball-kokotajlo-ai-governance.events.jsonl`

### Step 2: first real extraction run (the most important unknown)
```bash
pnpm --filter @adl/worker extract -- --fixture dt --turns 12 --skip 20 --llm
```
- If the API call fails, fix `packages/llm/src/client.ts` first. The likely spots: `output_config` with `zodOutputFormat` on `client.beta.messages.create`, and the `fallbacks` beta header. The claude-api skill is authoritative. Keep the refusal handling and the caching layout.
- Inspect `.data/dt.l1.events.jsonl`. Judge every proposition against ONTOLOGY §8 by hand. Record precision, faithfulness and hedge problems in `evals/results.md` (create it).
- Check `cacheReadTokens > 0` from the second call on. If it stays 0, something in `instructions` or `sessionContext` isn't stable.
- Iterate `packages/pipeline/src/prompts/l1-extract.ts`. **Bump `L1_PROMPT_VERSION` on every change.**

### Step 3: then follow the plan (IMPLEMENTATION_PLAN §3)
Priority order for the R0 deadline, **Fri 10/2** (a replay Stephanie can review):
1. **L2 critic** (`packages/pipeline/src/l2-critic.ts` + prompt): an independent prompt, given only spans + items, judged on the §8 rules → `critic.verdict` events. The reducer already handles them.
2. **L3 link** (identity resolution, cross-turn relations, presuppositions with the necessity test) and **L4 insight** (crux cards using `@adl/graph` `rankCruxes`; higher ground by construction type; prompts from unanswered critical questions).
3. **Full run on Dean × Daniel.** Measure cost and latency per pass, and compare against ARCHITECTURE §10.
4. **Cockpit replay simulation** at `/cockpit?session=…&replay=1`, following UX §3's four-quadrant layout, fed by the replay stream. Plus a static R0 page Stephanie can open (a published artifact or a Vercel preview).
5. **Gold segments** (QUALITY §2–3): model-drafted and human-corrected for development; **human-only for held-out**.

After R0: the operator console (UX §4), live capture (WS1, `services/capture/adl_capture/live.py`), stage levels 1–4, the 3D topology (WS5). Feature freeze is **Thu 10/8**.

## 5. Gotchas already discovered
- **pnpm passes a literal `--`** to scripts. Worker CLIs filter it out (`process.argv.slice(2).filter(a => a !== '--')`). Do the same in any new CLI.
- **TypeScript is pinned to ~5.9.** TS 7 (the native port) is `latest` on npm; don't upgrade before the event.
- **Fonts load through a `<link>` in `app/layout.tsx`, not `next/font`,** so builds don't need Google Fonts network access.
- **Next.js 16:** `params`/`searchParams` are Promises; `middleware` is now `proxy`; workspace packages are transpiled automatically. Read `apps/web/node_modules/next/dist/docs/` before writing web code. `next dev` may rewrite a managed block in AGENTS.md; commit it rather than fighting it.
- **`fallbacks: "default"` is typed in `@anthropic-ai/sdk` 0.129.** No `@ts-expect-error` needed.
- **The DT fixture has one `unknown`-speaker segment** (key `UNK`). Tests allow ≤ 1.
- **The web app reads replay files from `../../.data/`** relative to `apps/web` (dev only). On Vercel, use `DATABASE_URL`.
- **Opus 5.5 thinking can't be disabled;** control depth with `output_config.effort` (its default is `medium`, so set it explicitly per pass, as `models.ts` does).
- **The cloud container blocks** youtube.com, googlevideo.com, synthesismedia.org, anti-debate.org, substack.com and forum.effectivealtruism.org. Do network fetching locally.

## 6. Rules that must not bend (summary of AGENTS.md)
- The ontology is binding; change `docs/ONTOLOGY.md` before the code.
- Quotes come from the model; offsets come from code. No fuzzy span repair.
- Steelman, attribute and nonliteral speech acts never commit the speaker.
- Audience routes get `audienceView()` output only.
- `packages/core` reducers stay pure and deterministic.
- Nothing reaches the cockpit or an audience without passing validators, the critic and the operator gate. A feature that misses its QUALITY gate ships operator-only.
- No slop in UI copy, prompts or design (UX §2).
- Don't change the model or effort without measuring against gold sets. Every run logs prompt version, effort, tokens and cost.
- Commit small, run `pnpm check` before every push, keep `docs/NEXT_STEPS.md` current.

## 7. People and decisions

| Who | Role | Contact path |
|---|---|---|
| Benjamin Life | Owner, operator on the day, annotator | This repo / Claude sessions |
| Stephanie Lepp | Facilitator; client for Oct 11 | Via Benjamin |
| Oct 11 moderator | Game-theory background (confirm name) | Via Stephanie |

**Open questions** (also in `docs/client/stephanie-feedback.md`): debaters and topic; consent for live mapping and publication; who moderates; the R0 review slot (10/3–10/5); the rehearsal slot (10/9–10/10); the Progress Conference AV contact (separate mic outs, recording feed); hardware purchase.

**Decisions you may make without asking:** implementation details inside the docs' constraints, prompt wording (versioned), UI layout within UX.md, test structure.
**Ask Benjamin before:** changing the ontology, models or effort defaults; adding paid services; anything shown to Stephanie or published; schedule changes; anything outward-facing.

## 8. Definition of done for your session
- `pnpm check` green, CI green on `main`.
- `docs/NEXT_STEPS.md` updated with what you finished and what's next.
- A dated line in `evals/results.md` for every LLM run: prompt version, model, effort, turns, cost, p50 latency, and observed faithfulness issues.
- A short summary to Benjamin: what works, what doesn't, and what you need from him.
