import type { Metadata } from 'next';
import { Spatial } from '@/components/spatial/SpatialView';

export const metadata: Metadata = { title: 'Spatial · Anti-Debate Live' };

export default function SpatialPage() {
  return <Spatial />;
}
