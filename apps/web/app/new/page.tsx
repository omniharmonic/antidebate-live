import type { Metadata } from 'next';
import Link from 'next/link';
import { NewSessionForm } from './NewSessionForm';

export const metadata: Metadata = { title: 'New session · Anti-Debate Live' };

export default function NewSessionPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <Link href="/" className="text-sm text-ink-3 hover:text-ink">
        Sessions
      </Link>
      <h1 className="mt-4 text-[44px] leading-none">Start a session</h1>
      <div className="mt-10">
        <NewSessionForm />
      </div>
    </main>
  );
}
