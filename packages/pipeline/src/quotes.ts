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
