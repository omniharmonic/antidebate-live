import type { Setup } from './attributor';

/**
 * Voice-only decisions (no channel margin) are capped below the auto threshold in these setups,
 * so every such line is held for the host: the attribution gate has not measured them yet
 * (AGENTS non-negotiable 6, ruling P2-R9).
 * Removed per setup when the Plan 3 gate measures ≤2% wrong auto-accepts.
 */
export const VOICE_ONLY_CAP = 0.84;
export const VOICE_ONLY_CAPPED: readonly Setup[] = ['call', 'room'];

export const capVoiceOnly = (setup: Setup, confidence: number) => (VOICE_ONLY_CAPPED.includes(setup) ? Math.min(confidence, VOICE_ONLY_CAP) : confidence);
