import { notFound } from 'next/navigation';
import { SessionProvider } from '@/lib/session-context';
import { isValidSessionId } from '@/lib/session-id';

/** One event stream per session, shared by Explore, Facilitate and Operate. */
export default async function SessionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ session: string }> }) {
  const { session } = await params;
  if (!isValidSessionId(session)) notFound();
  return (
    <SessionProvider key={session} sessionId={session}>
      {children}
    </SessionProvider>
  );
}
