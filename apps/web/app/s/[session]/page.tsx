import { redirect } from 'next/navigation';

/** A bare session link opens Explore. */
export default async function SessionIndex({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  redirect(`/s/${encodeURIComponent(session)}/spatial`);
}
