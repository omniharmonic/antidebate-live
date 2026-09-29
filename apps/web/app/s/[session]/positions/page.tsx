import type { Metadata } from 'next';
import { Positions } from '@/components/positions/PositionsView';

export const metadata: Metadata = { title: 'Positions · Anti-Debate Live' };

export default function PositionsPage() {
  return <Positions />;
}
