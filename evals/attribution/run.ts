// Attribution lab harness: drives /host/lab in headless Chromium over every scenario and setup, and
// writes .data/scenarios/<fixture>/<setup>.result.json for the scorer.
//
//   pnpm tsx evals/attribution/run.ts [--fixture <slug>] [--setup <setup>[,<setup>...]]
//   setups: tracks, bleed (-15 dB), bleed-6, bleed-9, unmiked (no moderator mic), mono-live, mono-recording
//
// Needs the web app in development mode (the lab is not found in production), started with
// HOST_SIGNING_SECRET, and scenarios from `adl-scenarios` (services/capture). LAB_URL sets the
// target (default http://localhost:3000). HOST_SIGNING_SECRET comes from the environment or the
// root .env. No model calls: transcription is stubbed; speech separation runs in the page.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_COOKIE, signHostCookie } from '../../apps/web/lib/host-auth';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIOS = path.join(ROOT, '.data/scenarios');
const SETUPS = ['tracks', 'bleed', 'bleed-6', 'bleed-9', 'unmiked', 'mono-live', 'mono-recording'] as const;
type Setup = (typeof SETUPS)[number];
type Lab = { __adlLab?: { run(o: { fixture: string; setup: Setup }): Promise<Result> } };
type Result = { utterances: unknown[]; seconds: number; windowMs: number; enrolled: string[]; failed?: number; notices?: Record<string, number> };

// Playwright is a dependency of the web app, not of the root.
const { chromium } = createRequire(path.join(ROOT, 'apps/web/package.json'))('@playwright/test') as typeof import('@playwright/test');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function secret(): string {
  if (process.env.HOST_SIGNING_SECRET) return process.env.HOST_SIGNING_SECRET;
  const env = path.join(ROOT, '.env');
  const line = existsSync(env) ? readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('HOST_SIGNING_SECRET=')) : undefined;
  const value = line?.slice('HOST_SIGNING_SECRET='.length).trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error('HOST_SIGNING_SECRET is not set (environment or root .env).');
  return value;
}

async function main() {
  const base = process.env.LAB_URL ?? 'http://localhost:3000';
  const all = readdirSync(SCENARIOS).filter((f) => existsSync(path.join(SCENARIOS, f, 'reference.json'))).sort();
  const fixtures = arg('fixture') ? [arg('fixture')!] : all;
  for (const f of fixtures) if (!all.includes(f)) throw new Error(`no scenario ${f} in ${SCENARIOS} (have ${all.join(', ')})`);
  const setups = (arg('setup')?.split(',') ?? [...SETUPS]) as Setup[];
  for (const s of setups) if (!SETUPS.includes(s)) throw new Error(`unknown setup ${s} (one of ${SETUPS.join(', ')})`);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: HOST_COOKIE, value: await signHostCookie(secret(), Date.now()), url: base }]);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.goto(`${base}/host/lab`);
    await page.waitForFunction(() => Boolean((window as unknown as Lab).__adlLab), undefined, { timeout: 120_000 });
    for (const fixture of fixtures) {
      for (const setup of setups) {
        const r = (await page.evaluate((o) => (window as unknown as Lab).__adlLab!.run(o), { fixture, setup })) as Result;
        writeFileSync(path.join(SCENARIOS, fixture, `${setup}.result.json`), `${JSON.stringify({ fixture, setup, ...r }, null, 1)}\n`);
        const extra = r.failed !== undefined ? `, ${r.failed} failed, notices ${JSON.stringify(r.notices)}` : '';
        console.log(`${fixture} ${setup}: ${r.utterances.length} lines over ${(r.windowMs / 60_000).toFixed(1)} min in ${r.seconds} s, enrolled [${r.enrolled.join(', ')}]${extra}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
