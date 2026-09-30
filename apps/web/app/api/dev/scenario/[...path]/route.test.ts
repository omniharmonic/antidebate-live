import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const dir = mkdtempSync(path.join(tmpdir(), 'scenarios-'));
mkdirSync(path.join(dir, 'fx'));
writeFileSync(path.join(dir, 'fx', 'reference.json'), '{"turns":[]}');
writeFileSync(path.join(dir, 'secret.txt'), 'no');
const get = (...parts: string[]) => GET(new Request('http://x/'), { params: Promise.resolve({ path: parts }) });

afterEach(() => vi.unstubAllEnvs());

describe('/api/dev/scenario', () => {
  it('serves a scenario file in development', async () => {
    vi.stubEnv('ADL_SCENARIOS_DIR', dir);
    const res = await get('fx', 'reference.json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"turns":[]}');
  });
  it('is not found in production', async () => {
    vi.stubEnv('ADL_SCENARIOS_DIR', dir);
    vi.stubEnv('NODE_ENV', 'production');
    expect((await get('fx', 'reference.json')).status).toBe(404);
  });
  it('normalises the configured root: a trailing slash or a relative path still serves', async () => {
    vi.stubEnv('ADL_SCENARIOS_DIR', `${dir}${path.sep}`);
    expect((await get('fx', 'reference.json')).status).toBe(200);
    vi.stubEnv('ADL_SCENARIOS_DIR', path.relative(process.cwd(), dir));
    expect((await get('fx', 'reference.json')).status).toBe(200);
  });
  it('rejects paths that climb out, and missing files', async () => {
    vi.stubEnv('ADL_SCENARIOS_DIR', path.join(dir, 'fx'));
    expect((await get('..', 'secret.txt')).status).toBe(400);
    expect((await get('fx', '..%2F..%2Fsecret.txt')).status).toBe(400);
    expect((await get('nope.wav')).status).toBe(404);
  });
});
