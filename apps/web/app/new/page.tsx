import type { Metadata } from 'next';
import Link from 'next/link';
import { NewSessionForm } from './NewSessionForm';

export const metadata: Metadata = { title: 'New session · Anti-Debate Live' };

export default function NewSessionPage() {
  return (
    <main className="min-h-dvh bg-field">
      <header className="flex h-14 items-center gap-5 border-b border-border px-6">
        <Link href="/" className="label-caps !text-[13px] !tracking-[0.24em] text-ink hover:text-ink-2">
          Anti-Debate
        </Link>
        <span aria-hidden className="h-5 w-px bg-border" />
        <Link href="/" className="text-[14px] text-ink-3 hover:text-ink">
          Sessions
        </Link>
      </header>
      <div className="mx-auto max-w-3xl px-6 pb-20 pt-12">
        <h1 className="text-[30px] leading-tight text-ink">Start a session</h1>
        <div className="mt-10">
          <NewSessionForm />
        </div>
      </div>
    </main>
  );
}
