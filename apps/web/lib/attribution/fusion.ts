/**
 * Attribution fusion, ported from services/capture/adl_capture/fusion.py (ARCHITECTURE §2.1 step 8).
 * Same weights and threshold. `voiceMatch` is already on the 0..1 score scale.
 */
export const AUTO_THRESHOLD = 0.85;

export type Signals = {
  channelMarginDb: number | null;
  voiceMatch: number | null;
  diarizerAgrees: boolean | null;
  overlap: boolean;
};

const clip = (x: number) => Math.max(0, Math.min(1, x));

export function fuse(s: Signals): number {
  const parts: [number, number][] = [];
  if (s.channelMarginDb !== null) parts.push([0.5, clip(s.channelMarginDb / 12)]);
  if (s.voiceMatch !== null) parts.push([0.35, clip(s.voiceMatch)]);
  if (s.diarizerAgrees !== null) parts.push([0.15, s.diarizerAgrees ? 1 : 0]);
  if (!parts.length) return 0;
  let score = parts.reduce((n, [w, v]) => n + w * v, 0) / parts.reduce((n, [w]) => n + w, 0);
  if (s.overlap) score *= 0.8;
  return Math.round(clip(score) * 1000) / 1000;
}

export const needsOperator = (c: number, threshold = AUTO_THRESHOLD) => c < threshold;
