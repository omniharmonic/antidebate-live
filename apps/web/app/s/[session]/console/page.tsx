import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Console } from '@/components/console/ConsoleView';
import { isValidSessionId } from '@/lib/session-id';

export const metadata: Metadata = { title: 'Console · Anti-Debate Live' };

export default async function ConsolePage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  if (!isValidSessionId(session)) notFound();
  return <Console sessionId={session} />;
}
