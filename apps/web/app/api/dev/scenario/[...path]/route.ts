// Development only: serves the local attribution scenarios (.data/scenarios, gitignored) to the lab page.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const TYPES: Record<string, string> = { '.wav': 'audio/wav', '.json': 'application/json' };

const root = () => path.resolve(process.env.ADL_SCENARIOS_DIR ?? path.join(process.cwd(), '../../.data/scenarios'));

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });
  const { path: parts } = await ctx.params;
  if (parts.some((p) => p.includes('..') || p.includes('/') || p.includes('\\'))) return new Response('Bad path', { status: 400 });
  const base = root();
  const file = path.resolve(base, ...parts);
  if (!file.startsWith(base + path.sep)) return new Response('Bad path', { status: 400 });
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response('Not found', { status: 404 });
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': String(info.size), 'Cache-Control': 'no-store' } });
}
