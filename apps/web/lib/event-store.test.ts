import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@adl/core';

vi.mock('server-only', () => ({}));
vi.mock('@adl/db', () => ({ hasDb: () => false, appendEvents: async () => {}, readEvents: async () => [] }));
const stored = Array.from({ length: 2500 }, (_, i) => ({ eventId: `s:${i}`, sessionId: 's', type: 'round.ended' }) as unknown as DomainEvent);
vi.mock('./events-source', () => ({ loadLocalEvents: () => stored, appendLocalEvents: () => {} }));

describe('readAfter (local)', () => {
  it('pages with a cursor and says when more follow', async () => {
    const { readAfter } = await import('./event-store');
    const first = await readAfter('s', 0, 1000);
    expect(first).toMatchObject({ cursor: 1000, hasMore: true });
    expect(first.events).toHaveLength(1000);
    const last = await readAfter('s', 2000, 1000);
    expect(last).toMatchObject({ cursor: 2500, hasMore: false });
    expect(last.events).toHaveLength(500);
  });
});
