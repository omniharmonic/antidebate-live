import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { publicSessions, type SessionSummary } from './sessions';

const s = (id: string, ended: boolean): SessionSummary => ({ id, title: id, format: 'anti-debate', source: null, participants: [], startedAt: '2026-09-29T00:00:00Z', ended });

describe('publicSessions', () => {
  it('lists finished debates only', () => {
    expect(publicSessions([s('done', true), s('live-now', false)]).map((x) => x.id)).toEqual(['done']);
  });
});
