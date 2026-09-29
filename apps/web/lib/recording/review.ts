import type { ReviewLine } from './pipeline';

export type ReviewGroup = { label: string | null; lines: ReviewLine[] };

/**
 * Lines that came from one separated voice are grouped so the host can assign them at once;
 * lines without a voice label stand alone. Order follows each group's first line.
 */
export function groupReview(lines: ReviewLine[]): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  const byLabel = new Map<string, ReviewGroup>();
  for (const l of lines) {
    if (!l.diarLabel) { groups.push({ label: null, lines: [l] }); continue; }
    let g = byLabel.get(l.diarLabel);
    if (!g) { g = { label: l.diarLabel, lines: [] }; byLabel.set(l.diarLabel, g); groups.push(g); }
    g.lines.push(l);
  }
  return groups;
}
