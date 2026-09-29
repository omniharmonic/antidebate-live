import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages (@adl/*) ship TypeScript source; Turbopack compiles them automatically.
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      // The web app only ever calls Anthropic from the host's tab with their own key. Its
      // server never runs the node transport, so every environment here, including the
      // server render of client components, uses the browser entry and no node:* code.
      '@adl/llm': '@adl/llm/browser',
    },
  },
};

export default nextConfig;
