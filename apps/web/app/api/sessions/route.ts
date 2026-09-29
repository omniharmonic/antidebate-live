/** Public sessions index: GET → { sessions }, newest first. The same list as the public home page. */
import { listSessions, publicSessions } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessions = publicSessions(await listSessions());
    return Response.json({
      sessions: sessions.map(({ id, title, format, source, startedAt, eventCount, lastActivityAt, ended, participants }) => ({
        id,
        title,
        format,
        source,
        startedAt,
        eventCount,
        lastActivityAt,
        ended,
        participants,
      })),
    });
  } catch (err) {
    console.error('[api/sessions]', err);
    return Response.json({ error: 'could not list sessions' }, { status: 500 });
  }
}
