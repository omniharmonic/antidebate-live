/**
 * Single source of truth for model ids and per-pass effort (ARCHITECTURE §3.2).
 * Change models here only. Effort levels are starting points; tune them against
 * the gold sets (QUALITY §4), never by feel.
 *
 * 2026-09-28 (Benjamin): default every pass to Claude Sonnet 5.5 for cost. Opus is
 * an explicit opt-in per pass (LLM_MODEL_<PASS>=claude-opus-5-5) until the gold sets
 * show where it earns its price.
 *
 * Overrides (env): LLM_MODEL (all passes), LLM_MODEL_L4_INSIGHT etc. (one pass).
 */
export const SONNET = 'claude-sonnet-5-5' as const;
export const OPUS = 'claude-opus-5-5' as const;
export const MODEL = SONNET;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Pass = 'L1_extract' | 'L2_critic' | 'L3_link' | 'L4_insight' | 'round_detect' | 'speaker_id' | 'canonical' | 'ask_the_map';

const BASE: Record<Pass, { model: string; effort: Effort; maxTokens: number }> = {
  L1_extract: { model: MODEL, effort: 'medium', maxTokens: 16000 },
  L2_critic: { model: MODEL, effort: 'medium', maxTokens: 8000 },
  L3_link: { model: MODEL, effort: 'medium', maxTokens: 16000 },
  L4_insight: { model: MODEL, effort: 'high', maxTokens: 32000 },
  // Classification of moderator turns against the format's rounds: a small, closed choice.
  round_detect: { model: MODEL, effort: 'low', maxTokens: 4000 },
  // Proposes label → participant from self-identification in a transcript; always operator-confirmed.
  speaker_id: { model: MODEL, effort: 'medium', maxTokens: 8000 },
  canonical: { model: MODEL, effort: 'xhigh', maxTokens: 64000 },
  ask_the_map: { model: MODEL, effort: 'medium', maxTokens: 8000 },
};

export function passConfig(pass: Pass): { model: string; effort: Effort; maxTokens: number } {
  const base = BASE[pass];
  const model = process.env[`LLM_MODEL_${pass.toUpperCase()}`] ?? process.env.LLM_MODEL ?? base.model;
  return { ...base, model };
}

/** @deprecated read through passConfig() so env overrides apply. */
export const PASS_CONFIG = BASE;

/** List prices per MTok (ARCHITECTURE §10). Used for budget accounting on the API provider. */
export const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  [OPUS]: { in: 4, out: 20, cacheRead: 0.2 },
  // platform.claude.com/docs/en/about-claude/pricing, checked 2026-09-28
  [SONNET]: { in: 2, out: 10, cacheRead: 0.2 },
};

/** Dollar cost of one call. Unknown models are priced conservatively; cache writes bill at 1.25x input. */
export function costUsd(model: string, u: { input: number; cacheRead: number; cacheWrite: number; output: number }): number {
  const p = PRICES[model] ?? { in: 5, out: 25, cacheRead: 0.5 };
  return (u.input * p.in + u.cacheWrite * p.in * 1.25 + u.cacheRead * p.cacheRead + u.output * p.out) / 1e6;
}
