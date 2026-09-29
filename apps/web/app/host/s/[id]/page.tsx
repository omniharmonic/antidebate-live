import type { Metadata } from 'next';
import { HostBar } from '@/components/host/HostBar';
import { Runner } from './Runner';

export const metadata: Metadata = { title: 'Processing · Anti-Debate Live' };

export default async function HostSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="min-h-dvh bg-field">
      <HostBar />
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-12">
        <Runner id={id} />
      </div>
    </main>
  );
}
