/** Desktop Chrome or Edge, version 120 or later. Safari, Firefox and every mobile browser are out. */
export function browserSupport(userAgent: string): boolean {
  if (/Mobile|Android|iPhone|iPad|CriOS|FxiOS/.test(userAgent)) return false;
  const m = userAgent.match(/Chrome\/(\d+)/);
  return m !== null && Number(m[1]) >= 120;
}
