/**
 * An engine line (SessionEngine `say`) saying a per-turn pass (L1 extract, L2 critic) got
 * no answer from Anthropic: the provider was unreachable or returned an error. Answers the
 * pipeline rejected (refusal, parse error) and the background insight passes don't count.
 */
export function unansweredRequest(line: string): boolean {
  return /^L[12] \S+: provider_error:/.test(line);
}
