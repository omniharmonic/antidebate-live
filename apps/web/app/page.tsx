import Link from 'next/link';

const SURFACES = [
  { href: '/play/dt', name: 'Playback', spec: 'UX §7', status: 'Skeleton: transcript + state at time t from the event log (DT fixture)' },
  { href: '/stage/stage', name: 'Stage output', spec: 'UX §5', status: 'Skeleton: dial level from the audience-filtered stream' },
  { href: '/cockpit', name: 'Facilitator cockpit', spec: 'UX §3', status: 'Not built (WS4, due 10/2 for the R0 replay)' },
  { href: '/console', name: 'Operator console', spec: 'UX §4', status: 'Not built (WS4, 10/3–10/5)' },
  { href: '/setup', name: 'Event setup', spec: 'UX §8', status: 'Not built (R1)' },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-ink-3">antidebate-live · dev index</p>
      <h1 className="mt-3 text-5xl">Anti-Debate Live</h1>
      <p className="mt-4 max-w-prose text-ink-2">
        Surfaces, with their spec sections and build status. The documentation set lives in <code className="font-mono text-sm">docs/</code>.
      </p>
      <ul className="mt-10 divide-y divide-border border-y border-border">
        {SURFACES.map((s) => (
          <li key={s.href} className="grid grid-cols-[10rem_1fr] gap-4 py-4">
            <Link href={s.href} className="font-medium underline decoration-border underline-offset-4 hover:decoration-ink">
              {s.name}
            </Link>
            <span className="text-sm text-ink-2">
              <span className="font-mono text-ink-3">{s.spec}</span> · {s.status}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
