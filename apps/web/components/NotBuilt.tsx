import Link from 'next/link';

export function NotBuilt({ name, spec, workstream, due }: { name: string; spec: string; workstream: string; due: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-ink-3">{workstream} · due {due}</p>
      <h1 className="mt-3 text-4xl">{name}</h1>
      <p className="mt-4 text-ink-2">
        Not built yet. Specification: <code className="font-mono text-sm">docs/UX.md {spec}</code>.
      </p>
      <Link href="/" className="mt-8 inline-block text-sm underline underline-offset-4">
        All surfaces
      </Link>
    </main>
  );
}
