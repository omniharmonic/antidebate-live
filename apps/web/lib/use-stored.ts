'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
};

/** A localStorage value: undefined while rendering on the server, null when unset or unreadable. */
export function useStored(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => { try { return localStorage.getItem(key); } catch { return null; } },
    () => undefined,
  );
}
