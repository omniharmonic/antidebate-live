/**
 * The model returns verbatim quotes, never character offsets. Code locates
 * them in the utterance text (ONTOLOGY §8.1). A quote that can't be found
 * exactly fails validation; nothing is fuzzily "repaired" into a span.
 */
import type { Span, Utterance } from '@adl/ontology';

export function locateQuote(quote: string, utterances: Utterance[]): Span | null {
  const q = quote.trim();
  if (!q) return null;
  for (const u of utterances) {
    const i = u.text.indexOf(q);
    if (i >= 0) return { utteranceId: u.id, charStart: i, charEnd: i + q.length, quote: q };
  }
  return null;
}

/**
 * L1 sees a turn formed by joining transcript chunks with one space. A verbatim
 * quote can therefore cross a chunk boundary. Locate it in that exact text,
 * then split it back into independently verifiable source spans. No punctuation,
 * casing, missing words or speaker changes are repaired.
 */
export function locateQuoteSpans(quote: string, utterances: Utterance[]): Span[] | null {
  const q = quote.trim();
  if (!q) return null;
  const single = locateQuote(q, utterances);
  if (single) return [single];
  const text = utterances.map(u => u.text).join(' ');
  const start = text.indexOf(q);
  if (start < 0) return null;
  const end = start + q.length;
  const spans: Span[] = [];
  let offset = 0;
  let speaker: string | undefined;
  for (const u of utterances) {
    const from = Math.max(start, offset), to = Math.min(end, offset + u.text.length);
    if (from < to) {
      if (speaker !== undefined && speaker !== u.participantKey) return null;
      speaker = u.participantKey;
      const charStart = from - offset, charEnd = to - offset;
      spans.push({ utteranceId: u.id, charStart, charEnd, quote: u.text.slice(charStart, charEnd) });
    }
    offset += u.text.length + 1;
  }
  return spans.length ? spans : null;
}
