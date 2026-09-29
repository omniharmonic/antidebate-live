/** Failures per key in a sliding window. In-memory per instance: enough for one shared password. */
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  blocked(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string, now: number): void {
    this.hits.set(key, [...(this.hits.get(key) ?? []), now]);
  }
  reset(key: string): void {
    this.hits.delete(key);
  }
}
