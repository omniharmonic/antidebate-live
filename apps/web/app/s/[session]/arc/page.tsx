import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Arc } from '@/components/arc/ArcView';
import { isValidSessionId } from '@/lib/session-id';

export const metadata: Metadata = { title: 'Timeline · Anti-Debate Live' };

export default async function ArcPage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  if (!isValidSessionId(session)) notFound();
  return <Arc sessionId={session} />;
}
