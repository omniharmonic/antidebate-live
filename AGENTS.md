# AGENTS.md — antidebate-live

Guidance for AI coding agents (Claude Code and others) working in this repo. Read this first, then the doc for the area you're touching.

## What this is
A real-time mapping instrument for facilitated disagreement (the Anti-Debate format first). It listens to a live debate, builds a rigorous, quote-anchored argument map, gives the facilitator a cockpit and the audience a controlled detail dial, and becomes a playback explorer afterwards. Built by Benjamin Life (@omniharmonic). **First live deployment: Sun 2026-10-11, 2:00–3:30pm, Progress Conference, Lighthaven (Berkeley), facilitated by Stephanie Lepp.**

## Source of truth
- `docs/README.md`: decisions and index
- `docs/ONTOLOGY.md`: **binding.** Every schema, prompt, validator and renderer derives from it. Don't invent entity types, speech acts or relation types. Change the doc first.
- `docs/ARCHITECTURE.md`, `docs/UX.md`, `docs/QUALITY.md`, `docs/IMPLEMENTATION_PLAN.md` (dated workstreams), `docs/REUSE_AUDIT.md`
- `docs/client/`: Stephanie's feedback (verbatim) and the prior debates to replay

## Non-negotiables
1. **Fidelity over fluency.** Every mapped item is anchored to verbatim spans. The model returns quotes; code locates them (`packages/pipeline/src/quotes.ts`). Nothing is fuzzily matched.
2. **Attribute/steelman/nonliteral speech acts never commit the speaker** (ONTOLOGY §8.5). A validator enforces it; keep it that way.
3. **Audience channels receive only `audienceView()` output** (`packages/core/src/visibility.ts`). Never stream raw events or proposals to `/stage`, `/overlay` or `/p`.
4. **Event log is append-only; reducers are pure** (no clocks, no randomness in `packages/core`). Playback depends on it.
5. **No slop.** No filler copy, emoji, gradients, "AI shimmer", or unverifiable numbers in UI or prompts (UX §2).
6. **Quality gates before live features** (QUALITY §6). A module that misses its gate is operator-only.
7. Model: `claude-opus-5-5` via `@anthropic-ai/sdk`, configured only in `packages/llm/src/models.ts`. Don't change models or effort without measuring against the gold sets.

## Layout
```
apps/web          Next.js 16 surfaces + /api (read the Next docs note below)
apps/worker       replay / extract CLIs; becomes the live pipeline process
packages/ontology Zod schemas + deterministic validators (ONTOLOGY in code)
packages/core     event types, pure projections, snapshots, audience filter, fixture → events
packages/graph    commitment stores, disagreement, common ground, crux ranking, paths
packages/pipeline turn buffer (L0), quote locator, L1 extraction (prompt + mapper)
packages/llm      Anthropic SDK wrapper (caching layout, effort per pass, fallbacks, logging)
packages/db       Drizzle schema (events, snapshots, llm_calls) + helpers (Neon)
packages/ui       Open Field design tokens
services/capture  Python (uv): gate, fusion, merge, emit, offline transcription; live loop TBD
fixtures/         DT transcript + reference analysis; Anti-Debate manifests (media gitignored)
evals/            gold sets + scoring (to build: WS2)
```

## Commands
```bash
pnpm install
pnpm check                     # typecheck + tests (all TS packages)
pnpm replay:dt                 # DT fixture → .data/dt.events.jsonl
pnpm --filter @adl/worker extract -- --fixture dt --turns 10          # L0 turns, no API
pnpm --filter @adl/worker extract -- --fixture dt --turns 10 --llm    # + L1 (ANTHROPIC_API_KEY)
pnpm dev                       # web on :3000 → /play/dt, /stage/stage
cd services/capture && uv sync && uv run pytest
```

## Next.js 16
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

In this monorepo the docs are at `apps/web/node_modules/next/dist/docs/`. Known here: route `params`/`searchParams` are Promises; workspace packages are transpiled automatically by Turbopack; `middleware` is now `proxy` (see `03-api-reference/03-file-conventions/proxy.md`).
apps/web aliases @adl/llm to its browser entry (next.config.ts); never run LLM passes from apps/web server code — they run in the host's tab or the worker.

## Conventions
- TypeScript strict, ESM, `verbatimModuleSyntax` (use `import type`).
- Prompts are versioned modules (`*_PROMPT_VERSION`). Bump the version on any change; every call logs it.
- Tests: Vitest next to the code (`*.test.ts`). CI runs `pnpm check` and the capture tests.
- Commits: small and descriptive. Attribute work to Benjamin Life (@omniharmonic).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
