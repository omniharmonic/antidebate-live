import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/sessions', async (orig) => {
  const real = await orig<typeof import('@/lib/sessions')>();
  const s = (id: string, ended: boolean, host = false, published = false) => ({ id, title: id, format: 'open', source: null, participants: [], startedAt: 'w', ended, host, published });
  return { ...real, listSessions: async () => [s('finished', true), s('in-progress', false), s('rehearsal', true, true), s('published', true, true, true)] };
});

describe('GET /api/sessions', () => {
  it('lists only what the public home lists', async () => {
    const { GET } = await import('./route');
    const body = (await (await GET()).json()) as { sessions: { id: string }[] };
    expect(body.sessions.map((s) => s.id)).toEqual(['finished', 'published']);
  });
});
