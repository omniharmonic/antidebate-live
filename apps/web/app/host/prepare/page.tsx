import type { Metadata } from 'next';
import { HostBar } from '@/components/host/HostBar';
import { Prepare } from './Prepare';

export const metadata: Metadata = { title: 'Prepare this laptop · Anti-Debate Live' };

export default function PreparePage() {
  return (
    <main className="min-h-dvh bg-field">
      <HostBar />
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-12">
        <h1 className="text-[30px] leading-tight text-ink">Prepare this laptop</h1>
        <p className="mt-3 text-[15px] text-ink-2">Do this once per laptop, ideally the day before, on good Wi-Fi.</p>
        <div className="mt-8">
          <Prepare />
        </div>
      </div>
    </main>
  );
}
