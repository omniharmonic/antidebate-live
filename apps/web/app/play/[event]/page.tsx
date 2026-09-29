import { notFound, redirect } from 'next/navigation';
import { isValidSessionId } from '@/lib/session-id';

/** Keep existing playback links on the full, responsive explorer. */
export default async function PlayPage({ params, searchParams }: { params: Promise<{ event: string }>; searchParams: Promise<{ t?: string; sel?: string }> }) {
  const { event } = await params;
  if (!isValidSessionId(event)) notFound();
  const { t, sel } = await searchParams;
  const query = new URLSearchParams();
  if (t && Number.isFinite(Number(t))) query.set('t', t);
  if (sel) query.set('sel', sel);
  redirect(`/s/${encodeURIComponent(event)}/arc${query.size ? `?${query}` : ''}`);
}
