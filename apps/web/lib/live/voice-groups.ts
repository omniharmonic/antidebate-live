import { trimAnchor, type Anchor } from '../attribution/anchors';

/** Temporary voices are only for grouping; a match this good joins one. */
const TEMP_VOICE_MATCH = 0.5;
/** Two at most: each one is another clip in every grouping match (latency). */
export const MAX_TEMP_VOICES = 2;
const TEMP_ANCHOR_MS = 8_000;

export type VoiceGroup = { label: string; utteranceIds: string[] };

/**
 * Lines no enrolled voice matched, grouped by temporary "Voice N" clips so the host can name a voice
 * once. The clips are matched in a second pass of their own, never alongside the enrolled voices: a
 * clip that sounds like a debater would share that debater's cluster and zero their score.
 */
export class VoiceGroups {
  readonly groups: VoiceGroup[] = [];
  private readonly temp: { label: string; pcm: Float32Array }[] = [];
  /** Labels are never reused, even after their lines are confirmed away. */
  private count = 0;

  constructor(private readonly match: (anchors: Anchor[], pcm: Float32Array) => Promise<Record<string, number>>) {}

  /** Joins the line to the temporary voice it matches, or starts the next one (up to the cap). */
  async add(id: string, pcm: Float32Array): Promise<void> {
    let top: [string, number] | null = null;
    if (this.temp.length > 0) {
      let scores: Record<string, number>;
      try {
        scores = await this.match(this.temp.map((t) => ({ key: t.label, pcm: t.pcm })), pcm);
      } catch {
        return; // not grouped: the line stays on its own for the host
      }
      for (const [k, v] of Object.entries(scores)) if (!top || v > top[1]) top = [k, v];
    }
    if (top && top[1] >= TEMP_VOICE_MATCH) {
      const label = top[0];
      const group = this.groups.find((g) => g.label === label);
      // A group emptied by confirming its lines is recreated when the same voice speaks again.
      if (group) group.utteranceIds.push(id);
      else this.groups.push({ label, utteranceIds: [id] });
      return;
    }
    if (this.temp.length >= MAX_TEMP_VOICES) return;
    const label = `Voice ${++this.count}`;
    const trimmed = trimAnchor(pcm, TEMP_ANCHOR_MS);
    this.temp.push({ label, pcm: trimmed.length > 0 ? trimmed : pcm.slice(0, (16_000 * TEMP_ANCHOR_MS) / 1000) });
    this.groups.push({ label, utteranceIds: [id] });
  }

  remove(ids: string[]): void {
    for (const g of this.groups) g.utteranceIds = g.utteranceIds.filter((u) => !ids.includes(u));
    for (let i = this.groups.length - 1; i >= 0; i--) if (this.groups[i]!.utteranceIds.length === 0) this.groups.splice(i, 1);
  }
}
