#!/usr/bin/env bash
# SessionStart hook: make a fresh checkout ready to build and test.
# Runs in Claude Code cloud sessions and locally; idempotent and quick when already installed.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile --reporter=silent >/dev/null 2>&1 || pnpm install --reporter=silent >/dev/null 2>&1 || echo "pnpm install failed; run it manually"
else
  echo "pnpm not found. Enable it with: corepack enable"
fi

if command -v uv >/dev/null 2>&1; then
  (cd services/capture && uv sync --quiet >/dev/null 2>&1) || echo "uv sync failed in services/capture"
fi

[ -f .env ] || echo "No .env yet: copy .env.example and set ANTHROPIC_API_KEY (and DATABASE_URL when ready)."
echo "antidebate-live ready. Read docs/NEXT_STEPS.md. Checks: pnpm check"
