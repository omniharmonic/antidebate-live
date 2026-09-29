export type LoadErrorKind = 'network' | 'load';

/** A fetch or download failure is 'network'; anything else while loading (session creation, compile, memory) is 'load'. */
export function classifyLoadError(err: unknown): LoadErrorKind {
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|network|failed to download|load failed|http \d{3}/i.test(msg) ? 'network' : 'load';
}
