/**
 * SSE event stream (ARCHITECTURE §5).
 *   /api/events/stream?session=dt&after=0&view=console|cockpit|stage:<channel>
 * Audience views (stage:*) receive ONLY the server-computed AudienceView,
 * never raw events. Role-link auth is not implemented yet (R1, WS3).
 */
import { audienceView, project, type ChannelId, type DomainEvent } from '@adl/core';
import { hasDb, readEvents } from '@adl/db';
import { loadLocalEvents } from '@/lib/events-source';

export const dynamic = 'force-dynamic';

const POLL_MS = 400;
const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = url.searchParams.get('session') ?? 'dt';
  const view = url.searchParams.get('view') ?? 'console';
  let cursor = Number(url.searchParams.get('after') ?? 0);
  const audience = view.startsWith('stage:') ? (view.slice(6) as ChannelId) : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const all: DomainEvent[] = [];
      const push = (batch: DomainEvent[]) => {
        if (batch.length === 0) return;
        all.push(...batch);
        if (audience) controller.enqueue(sse('audience', audienceView(project(session, all), audience)));
        else controller.enqueue(sse('events', { cursor, events: batch }));
      };

      if (!hasDb()) {
        const local = loadLocalEvents(session);
        cursor = local.length;
        push(local);
        controller.enqueue(sse('end', { reason: 'local replay file fully sent' }));
        controller.close();
        return;
      }
      while (!req.signal.aborted) {
        const rows = await readEvents(session, cursor);
        if (rows.length) cursor = rows.at(-1)!.cursor;
        push(rows.map((r) => r.event));
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
