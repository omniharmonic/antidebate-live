import { beforeEach, describe, expect, it } from 'vitest';
import { hostSessions, rememberHostSession, markHostSession } from './host-sessions';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });

describe('host sessions on this device', () => {
  it('lists newest first and replaces an entry with the same id', () => {
    rememberHostSession({ id: 'a', title: 'A', createdAt: '2026-09-01T00:00:00Z', kind: 'recording' });
    rememberHostSession({ id: 'b', title: 'B', createdAt: '2026-09-02T00:00:00Z', kind: 'recording' });
    rememberHostSession({ id: 'a', title: 'A2', createdAt: '2026-09-01T00:00:00Z', kind: 'recording' });
    expect(hostSessions().map((s) => s.title)).toEqual(['B', 'A2']);
  });

  it('marks a session done', () => {
    rememberHostSession({ id: 'a', title: 'A', createdAt: '2026-09-01T00:00:00Z', kind: 'recording' });
    markHostSession('a', { done: true });
    expect(hostSessions()[0]!.done).toBe(true);
  });

  it('survives corrupt or missing storage', () => {
    localStorage.setItem('adl.hostSessions', '{not json');
    expect(hostSessions()).toEqual([]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(hostSessions()).toEqual([]);
    expect(() => rememberHostSession({ id: 'a', title: 'A', createdAt: 'x', kind: 'recording' })).not.toThrow();
  });
});
