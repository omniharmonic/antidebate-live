// Prebuilt sherpa-onnx browser diarization (pyannote segmentation-3.0 + speaker embedding), Apache-2.0.
// The bundle is ~58 MB, so it is not committed; it is pulled at dev and build time.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1.13.7';
const NAME = `sherpa-onnx-wasm-simd-${VERSION}-speaker-diarization`;
const dest = fileURLToPath(new URL('../public/sherpa/', import.meta.url));
if (existsSync(join(dest, 'sherpa-onnx-wasm-main-speaker-diarization.wasm'))) process.exit(0);

try {
  mkdirSync(dest, { recursive: true });
  const tmp = join(tmpdir(), `${NAME}.tar.bz2`);
  execSync(`curl -fsSL -o "${tmp}" https://github.com/k2-fsa/sherpa-onnx/releases/download/${VERSION}/${NAME}.tar.bz2`, { stdio: 'inherit' });
  execSync(`tar xjf "${tmp}" -C "${tmpdir()}"`, { stdio: 'inherit' });
  const src = join(tmpdir(), NAME);
  // Only the runtime files move; the bundle's demo page script and our committed worker stay as they are.
  for (const f of readdirSync(src)) {
    if (/\.(js|wasm|data)$/.test(f) && f !== 'app-speaker-diarization.js' && f !== 'diarize-worker.js') renameSync(join(src, f), join(dest, f));
  }
  rmSync(src, { recursive: true, force: true });
  rmSync(tmp, { force: true });
  if (!existsSync(join(dest, 'sherpa-onnx-wasm-main-speaker-diarization.wasm'))) throw new Error('the wasm file was not in the bundle');
  console.log(`sherpa-onnx ${VERSION} -> public/sherpa`);
} catch (err) {
  console.error(`fetch-sherpa failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
