import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { publicSessions, type SessionSummary } from './sessions';

const s = (id: string, ended: boolean, extra: Partial<SessionSummary> = {}): SessionSummary => ({ id, title: id, format: 'anti-debate', source: null, participants: [], startedAt: '2026-09-29T00:00:00Z', ended, host: false, published: false, ...extra });

describe('publicSessions', () => {
  it('lists finished debates only', () => {
    expect(publicSessions([s('done', true), s('live-now', false)]).map((x) => x.id)).toEqual(['done']);
  });
  it('keeps a host session off the list until the host publishes it', () => {
    const list = [s('showcase', true), s('rehearsal', true, { host: true }), s('published', true, { host: true, published: true }), s('host-live', false, { host: true, published: true })];
    expect(publicSessions(list).map((x) => x.id)).toEqual(['showcase', 'published']);
  });
});
