import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Lab } from './Lab';

export const metadata: Metadata = { title: 'Attribution lab · Anti-Debate Live' };

/** Development only: the attribution gate's harness page (evals/attribution/run.ts drives it). */
export default function LabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Lab />;
}
