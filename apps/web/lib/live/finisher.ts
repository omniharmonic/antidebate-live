/**
 * Ending a live session in two parts: `drain` (stop the runner, let the engine finish) happens once
 * and cannot be undone; `deliver` (session.ended, upload) may fail and is re-run by "Try ending again".
 */
export function finisher(drain: () => Promise<void>, deliver: () => Promise<void>): () => Promise<void> {
  let drained: Promise<void> | null = null;
  return async () => {
    drained ??= drain();
    try {
      await drained;
    } catch (e) {
      drained = null;
      throw e;
    }
    await deliver();
  };
}
