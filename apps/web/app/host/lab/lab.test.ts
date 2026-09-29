import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

describe('/host/lab', () => {
  it('is not found in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: Page } = await import('./page');
    expect(() => Page()).toThrow('NEXT_NOT_FOUND');
    vi.unstubAllEnvs();
  });
});
