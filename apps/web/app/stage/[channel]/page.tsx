import { StageOutput } from '@/components/StageOutput';

export default async function StagePage({ params, searchParams }: { params: Promise<{ channel: string }>; searchParams: Promise<{ session?: string }> }) {
  const { channel } = await params;
  const { session } = await searchParams;
  return <StageOutput channel={channel} session={session ?? 'dt'} />;
}
