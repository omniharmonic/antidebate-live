import { describe, expect, it } from 'vitest';
import { finisher } from './finisher';

describe('finisher', () => {
  it('drains once; a failed delivery is retried without draining again', async () => {
    let drains = 0;
    let deliveries = 0;
    let offline = true;
    const finish = finisher(async () => { drains++; }, async () => { deliveries++; if (offline) throw new Error('offline'); });
    await expect(finish()).rejects.toThrow('offline');
    offline = false;
    await finish();
    expect(drains).toBe(1);
    expect(deliveries).toBe(2);
  });
  it('drains again when draining itself failed', async () => {
    let drains = 0;
    const finish = finisher(async () => { if (++drains === 1) throw new Error('boom'); }, async () => {});
    await expect(finish()).rejects.toThrow('boom');
    await finish();
    expect(drains).toBe(2);
  });
});
