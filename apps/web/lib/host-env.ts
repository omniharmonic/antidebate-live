import 'server-only';

/** Both secrets must be set, or hosting is closed (never open by default). */
export function hostEnv(): { password: string; secret: string } | null {
  const password = process.env.HOST_PASSWORD;
  const secret = process.env.HOST_SIGNING_SECRET;
  return password && secret && secret.length >= 16 ? { password, secret } : null;
}
