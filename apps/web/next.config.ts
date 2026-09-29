import type { NextConfig } from 'next';

// Cross-origin isolation lets ORT's WASM backend use threads (SharedArrayBuffer). COEP
// `credentialless` keeps cdn.jsdelivr.net (ORT) and Hugging Face (model files) loading without CORP
// headers. Only the host tool and the assets its workers load carry it; public pages may embed
// third-party media and never get these headers. A script response carrying COEP does not change
// the embedding page's own policy, so sharing /_next with public pages is safe.
const ISOLATION = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
];

const nextConfig: NextConfig = {
  async headers() {
    return ['/host/:path*', '/_next/:path*', '/sherpa/:path*'].map((source) => ({ source, headers: ISOLATION }));
  },
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
