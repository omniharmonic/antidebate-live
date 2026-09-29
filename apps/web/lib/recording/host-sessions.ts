/**
 * The sessions started from this browser (spec §6.1), and the recording file handed from
 * the new-session form to the runner. The file lives only in memory: a reload loses it,
 * and the runner asks for the same file again to resume.
 */
export type HostSession = { id: string; title: string; createdAt: string; kind: 'recording' | 'live'; done?: boolean };

const KEY = 'adl.hostSessions';

export const HOST_SESSIONS_KEY = KEY;

/** The stored list, newest first; anything unreadable is an empty list. */
export function parseHostSessions(raw: string | null | undefined): HostSession[] {
  try {
    const list = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(list) ? (list as HostSession[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  } catch {
    return [];
  }
}

export function hostSessions(): HostSession[] {
  try {
    return parseHostSessions(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function save(list: HostSession[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: the list is a convenience */ }
}

export function rememberHostSession(s: HostSession): void {
  save([...hostSessions().filter((x) => x.id !== s.id), s]);
}

export function markHostSession(id: string, patch: Partial<Omit<HostSession, 'id'>>): void {
  save(hostSessions().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

/** Session id → the chosen file, for the hop from /host/new to /host/s/<id>. */
export const pendingFiles = new Map<string, File>();
