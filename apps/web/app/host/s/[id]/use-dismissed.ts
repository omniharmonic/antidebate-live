'use client';

import { useCallback, useState } from 'react';

/** Lines the host said are not a speaker, kept for this browser so a reload does not list them again. */
export function useDismissed(id: string) {
  const storageKey = `adl.dismissed.${id}`;
  const [ids, setIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const add = useCallback((more: string[]) => setIds((prev) => {
    const next = new Set([...prev, ...more]);
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* kept for this page only */ }
    return next;
  }), [storageKey]);
  return [ids, add] as const;
}
