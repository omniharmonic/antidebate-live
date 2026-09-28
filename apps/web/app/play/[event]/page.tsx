import { notFound } from 'next/navigation';
import { loadLocalEvents } from '@/lib/events-source';
import { PlaybackSkeleton } from '@/components/PlaybackSkeleton';

export default async function PlayPage({ params }: { params: Promise<{ event: string }> }) {
  const { event } = await params;
  const events = loadLocalEvents(event);
  if (events.length === 0) notFound();
  return <PlaybackSkeleton sessionId={event} events={events} />;
}
