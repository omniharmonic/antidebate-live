import type { Word } from '../asr/chunks';

/** Diarizer boundaries relative to the captured clip, with enrolled-voice scores. */
export type VoiceTurn = { startMs: number; endMs: number; label: string; voice: Record<string, number> };

/** Keep every ASR word exactly once. Gaps, overlapping voices and boundary words stay uncertain. */
export function splitSpeakerTurns(words: Word[], turns: VoiceTurn[], offsetMs: number) {
  const parts: { words: Word[]; voice: Record<string, number>; uncertain: boolean; label: string | null }[] = [];
  for (const word of words) {
    const start = word.startMs - offsetMs;
    const end = word.endMs - offsetMs;
    const mid = (start + end) / 2;
    const hits = turns.filter((t) => t.startMs <= mid && t.endMs > mid);
    const labels = new Set(hits.map((t) => t.label));
    const chosen = labels.size === 1 ? hits[0] : undefined;
    const label = chosen?.label ?? null;
    const uncertain = !chosen || turns.some((t) => t.label !== label && t.startMs < end + 300 && t.endMs > start - 300);
    const previous = parts.at(-1);
    if (previous && previous.label === label && previous.uncertain === uncertain) previous.words.push(word);
    else parts.push({ words: [word], voice: chosen?.voice ?? {}, uncertain, label });
  }
  return parts;
}
