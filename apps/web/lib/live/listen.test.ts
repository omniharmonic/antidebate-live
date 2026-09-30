import { afterEach, expect, it, vi } from 'vitest';
import { tapAll } from './capture';
import { listen } from './listen';

vi.mock('./capture', () => ({ tapAll: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it('stopping the browser tap delivers its unfinished speech before the runner is stopped', async () => {
  const stopTap = vi.fn();
  let feed!: Parameters<typeof tapAll>[1];
  vi.mocked(tapAll).mockImplementation(async (_streams, forward) => { feed = forward; return stopTap; });
  const runner = { onUtterance: vi.fn(async () => {}), tick: vi.fn() };
  const stop = await listen({ streams: [], channels: ['d0c0'], mono: true, runner, startedAt: Date.now() });
  for (let i = 0; i < 200; i++) feed('d0c0', Float32Array.from({ length: 320 }, (_, j) => (i < 100 ? 0.001 : 0.2) * Math.sin(j)), i * 20);
  expect(runner.onUtterance).not.toHaveBeenCalled();
  stop();
  expect(stopTap).toHaveBeenCalled();
  expect(runner.onUtterance).toHaveBeenCalledOnce();
  expect(vi.mocked(tapAll).mock.calls[0]?.[2]).toBe(true);
  stop();
  expect(runner.onUtterance).toHaveBeenCalledOnce();
});
