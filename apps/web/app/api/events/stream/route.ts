/**
 * SSE event stream (ARCHITECTURE §5).
 *   /api/events/stream?session=dt&after=0&view=console|cockpit|stage:<channel>
 *
 * Operator views get `event: events` batches of { cursor, events }. Audience
 * views (stage:*) receive ONLY the server-computed AudienceView, never raw events.
 * Neon: polls the log. Local: sends `.data/<session>.events.jsonl`, then tails it
 * for appended lines every 500 ms (the worker appends live).
 * Word-level timings are stripped from utterances (no surface uses them yet).
 * Role-link auth is not implemented yet (R1, WS3).
 */
import { audienceView, project, type ChannelId, type DomainEvent } from '@adl/core';
import { hasDb, readEvents } from '@adl/db';
import { isValidSessionId, JsonlTail } from '@/lib/events-source';

export const dynamic = 'force-dynamic';
/** Serverless cap; the client reconnects with `after=<cursor>` when the stream ends. */
export const maxDuration = 300;

const DB_POLL_MS = 400;
/** Rows per Neon query. Large so a finished session loads in one or two round trips. */
const CATCH_UP_BATCH = 3000;
const FILE_POLL_MS = 500;
const KEEPALIVE_MS = 15_000;
const BATCH = 1500;
const enc = new TextEncoder();
const sse = (event: string, data: unknown, id?: number) =>
  enc.encode(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
/** Close a little before maxDuration so the client reconnects cleanly with Last-Event-ID. */
const DB_SESSION_MS = 290_000;

function lighten(e: DomainEvent): DomainEvent {
  if (e.type !== 'utterance.final' || e.payload.utterance.words.length === 0) return e;
  return { ...e, payload: { utterance: { ...e.payload.utterance, words: [] } } };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = url.searchParams.get('session') ?? 'dt';
  if (!isValidSessionId(session)) return Response.json({ error: 'invalid session' }, { status: 400 });
  const view = url.searchParams.get('view') ?? 'console';
  // resume point: EventSource sends Last-Event-ID on its own reconnects; our client passes ?after=
  const lastId = Number(req.headers.get('last-event-id') ?? NaN);
  let cursor = Number.isFinite(lastId) && lastId > 0 ? lastId : Number(url.searchParams.get('after') ?? 0) || 0;
  const audience = view.startsWith('stage:') ? (view.slice(6) as ChannelId) : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      req.signal.addEventListener('abort', close);

      const all: DomainEvent[] = [];
      const send = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          close();
        }
      };
      const push = (batch: DomainEvent[]) => {
        if (batch.length === 0) return;
        if (audience) {
          all.push(...batch);
          send(sse('audience', audienceView(project(session, all), audience)));
          return;
        }
        for (let i = 0; i < batch.length; i += BATCH) {
          const slice = batch.slice(i, i + BATCH).map(lighten);
          send(sse('events', { cursor, events: slice }, cursor));
        }
      };

      let lastSent = Date.now();
      const keepalive = () => {
        if (Date.now() - lastSent > KEEPALIVE_MS) {
          send(enc.encode(`: keepalive\n\n`));
          lastSent = Date.now();
        }
      };
      send(sse('ready', { session, mode: hasDb() ? 'db' : 'local' }));

      try {
        if (!hasDb()) {
          const tail = new JsonlTail(session);
          let skip = cursor; // local cursor = number of lines already delivered
          while (!closed) {
            let batch = tail.read();
            if (tail.truncated) {
              tail.truncated = false;
              skip = 0;
              cursor = 0;
              send(sse('reset', { reason: 'log rewritten' }));
            }
            if (skip > 0) {
              const n = Math.min(skip, batch.length);
              batch = batch.slice(n);
              skip -= n;
            }
            if (batch.length) {
              cursor += batch.length;
              push(batch);
              lastSent = Date.now();
            }
            keepalive();
            await new Promise((r) => setTimeout(r, FILE_POLL_MS));
          }
          return;
        }
        const deadline = Date.now() + DB_SESSION_MS;
        while (!closed) {
          if (Date.now() > deadline) {
            send(sse('reconnect', { cursor }));
            close();
            return;
          }
          const rows = await readEvents(session, cursor, CATCH_UP_BATCH);
          if (rows.length) {
            cursor = rows.at(-1)!.cursor;
            push(rows.map((r) => r.event));
            lastSent = Date.now();
          }
          keepalive();
          // a full page means more is waiting: read again immediately
          if (rows.length < CATCH_UP_BATCH) await new Promise((r) => setTimeout(r, DB_POLL_MS));
        }
      } catch (err) {
        send(sse('error', { message: err instanceof Error ? err.message : String(err) }));
        close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
