import type { Metadata } from 'next';
import { HostBar } from '@/components/host/HostBar';
import { HostNewForm } from './HostNewForm';

export const metadata: Metadata = { title: 'New session · Anti-Debate Live' };

export default async function HostNewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { kind } = await searchParams;
  return (
    <main className="min-h-dvh bg-field">
      <HostBar />
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-12">
        <h1 className="text-[30px] leading-tight text-ink">New session</h1>
        {kind === 'live' && <p className="mt-3 text-[15px] text-ink-2">Live capture is coming next. For now, sessions are processed from a recording.</p>}
        <div className="mt-8">
          <HostNewForm />
        </div>
      </div>
    </main>
  );
}
