'use client';

import { useEffect, useState } from 'react';

export const PAUSE_NOTE = 'Processing pauses if you close this tab. You can resume from this page.';

/**
 * While a recording is processing: warn before closing the tab, keep the screen awake
 * (a sleeping laptop stops the work), and report when the tab is in the background,
 * where Chrome slows timers and the work with them. Returns whether the tab is hidden.
 */
export function useProcessingGuards(active: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = PAUSE_NOTE; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const acquire = async () => {
      // The browser releases the lock whenever the tab is hidden; take it again on return.
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock?.request('screen');
        if (!live) void l?.release();
        else lock = l ?? null;
      } catch {
        // refused (battery saver, permissions policy): processing still works while the screen is on
      }
    };
    const onVisibility = () => {
      setHidden(document.visibilityState === 'hidden');
      void acquire();
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release();
      setHidden(false);
    };
  }, [active]);

  return hidden;
}
