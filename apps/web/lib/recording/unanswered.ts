/**
 * An engine line (SessionEngine `say`) saying a per-turn pass (L1 extract, L2 critic) got
 * no answer from Anthropic: the provider was unreachable or returned an error. Answers the
 * pipeline rejected (refusal, parse error) and the background insight passes don't count.
 */
export function unansweredRequest(line: string): boolean {
  return /^L[12] \S+: provider_error:/.test(line);
}

/** An engine line saying Anthropic refused the host's key (401/403) on any pass: stop and ask for a working key. */
export function keyRejected(line: string): boolean {
  return /provider_error: Anthropic returned 40[13]$/.test(line);
}
