// Test fixture for legacy single-speaker runner cases. Mixed-speaker tests supply real boundaries.
import type { LiveRunnerOptions } from './runner-types';
export function singleVoice(voices: Pick<LiveRunnerOptions['voices'], 'matchVoices'>): LiveRunnerOptions['voices'] {
  return { ...voices, matchTurns: async (anchors, pcm) => [{ startMs: 0, endMs: pcm.length / 16, label: 'one', voice: await voices.matchVoices(anchors, pcm) }] };
}
