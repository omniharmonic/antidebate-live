import type { Metadata } from 'next';
import { HostBar } from '@/components/host/HostBar';
import { HostHome } from './HostHome';

export const metadata: Metadata = { title: 'Your sessions · Anti-Debate Live' };

export default function HostPage() {
  return (
    <main className="min-h-dvh bg-field">
      <HostBar />
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-12">
        <h1 className="text-[30px] leading-tight text-ink">Your sessions</h1>
        <HostHome />
      </div>
    </main>
  );
}
