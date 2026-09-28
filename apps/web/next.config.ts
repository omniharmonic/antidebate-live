import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages (@adl/*) ship TypeScript source; Turbopack compiles them automatically.
  reactStrictMode: true,
};

export default nextConfig;
