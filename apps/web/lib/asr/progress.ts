/**
 * parakeet.js downloads model files one at a time and reports progress only for the current file,
 * so the overall size is unknown. We report what is true: which file, and how many bytes so far.
 */
export type HubProgress = { file: string; loaded: number; total: number };
export type ProgressState = { order: string[]; loaded: Record<string, number> };
export type DownloadReport = { phase: 'download'; fileNumber: number; bytes: number };

export const emptyProgress = (): ProgressState => ({ order: [], loaded: {} });

export function aggregateProgress(state: ProgressState, p: HubProgress): { state: ProgressState; report: DownloadReport } {
  const order = state.order.includes(p.file) ? state.order : [...state.order, p.file];
  const loaded = { ...state.loaded, [p.file]: Math.max(state.loaded[p.file] ?? 0, p.loaded) };
  const bytes = Object.values(loaded).reduce((a, b) => a + b, 0);
  return { state: { order, loaded }, report: { phase: 'download', fileNumber: order.length, bytes } };
}
