/** Session ids become file names locally: letters, digits, dot, dash, underscore; no traversal. */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes('..');
}

/** `<slug>-<yyyymmdd-hhmm>` (R0_DEMO "Session ids"). */
export function newSessionId(title: string, at = new Date()): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'session';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${slug}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
}
