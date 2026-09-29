/**
 * Single source of truth for model ids and per-pass effort (ARCHITECTURE §3.2).
 * Change models here only. Effort levels are starting points; tune them against
 * the gold sets (QUALITY §4), never by feel.
 */
export const MODEL = 'claude-opus-5-5' as const;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Pass = 'L1_extract' | 'L2_critic' | 'L3_link' | 'L4_insight' | 'round_detect' | 'speaker_id' | 'canonical' | 'ask_the_map';

export const PASS_CONFIG: Record<Pass, { model: string; effort: Effort; maxTokens: number }> = {
  L1_extract: { model: MODEL, effort: 'medium', maxTokens: 16000 },
  L2_critic: { model: MODEL, effort: 'medium', maxTokens: 8000 },
  L3_link: { model: MODEL, effort: 'high', maxTokens: 16000 },
  L4_insight: { model: MODEL, effort: 'high', maxTokens: 32000 },
  // Classification of moderator turns against the format's rounds: a small, closed choice.
  round_detect: { model: MODEL, effort: 'low', maxTokens: 4000 },
  // Proposes label → participant from self-identification in a transcript; always operator-confirmed.
  speaker_id: { model: MODEL, effort: 'medium', maxTokens: 8000 },
  canonical: { model: MODEL, effort: 'xhigh', maxTokens: 64000 },
  ask_the_map: { model: MODEL, effort: 'medium', maxTokens: 8000 },
};
