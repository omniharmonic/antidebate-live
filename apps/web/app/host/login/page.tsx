import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Host sign-in · Anti-Debate Live' };

export default async function HostLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-dvh bg-field">
      <div className="mx-auto max-w-md px-6 pb-20 pt-24">
        <h1 className="text-[30px] leading-tight text-ink">Host a session</h1>
        <p className="mt-3 text-[15px] text-ink-2">Hosting is for invited facilitators. Enter the host password you were given. This device stays signed in for 30 days.</p>
        <div className="mt-8">
          <LoginForm next={next ?? '/host'} />
        </div>
      </div>
    </main>
  );
}
