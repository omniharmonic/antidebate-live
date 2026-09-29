import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Cockpit } from '@/components/cockpit/CockpitView';
import { isValidSessionId } from '@/lib/session-id';

export const metadata: Metadata = { title: 'Cockpit · Anti-Debate Live' };

export default async function CockpitPage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  if (!isValidSessionId(session)) notFound();
  return <Cockpit sessionId={session} />;
}
