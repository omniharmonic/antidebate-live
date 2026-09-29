import { redirect } from 'next/navigation';

/** Surfaces are per session now: /s/<session>/… */
export default function Page() {
  redirect('/');
}
