import type { SpeakerSegment } from '@/lib/diarize/client';

/** A separated voice with less speech than this is not offered for naming; it stays unattributed. */
export const MIN_VOICE_MS = 10_000;

export type Voice = { label: string; totalMs: number; longest: SpeakerSegment[] };

/** Voices to name (longest speech first, three longest stretches each) and the labels of the short ones left out. */
export function groupVoices(segments: readonly SpeakerSegment[]): { voices: Voice[]; shortLabels: string[] } {
  const by = new Map<string, SpeakerSegment[]>();
  for (const s of segments) by.set(s.label, [...(by.get(s.label) ?? []), s]);
  const all = [...by.entries()].map(([label, segs]) => ({
    label,
    totalMs: segs.reduce((n, s) => n + s.endMs - s.startMs, 0),
    longest: [...segs].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)).slice(0, 3),
  }));
  return {
    voices: all.filter((v) => v.totalMs >= MIN_VOICE_MS).sort((a, b) => b.totalMs - a.totalMs),
    shortLabels: all.filter((v) => v.totalMs < MIN_VOICE_MS).map((v) => v.label),
  };
}
