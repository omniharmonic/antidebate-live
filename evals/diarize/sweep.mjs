// Speaker-separation sweep. Usage:
//   node sweep.mjs --fixture <slug> --window 3min|20min [--start S] [--dur D] --shift 0.5 [--out file]
//   node sweep.mjs --pick-3min   (print the chosen 3-minute windows)
// Node WASM sherpa-onnx (same pyannote segmentation-3.0 + eres2net models as the browser bundle).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'fixtures/antidebate');
const MODELS = path.join(ROOT, '.data/diarize-models');
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];
const TINY_SECS = [5, 10, 20];
const FRAME = 0.01;

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : a), []));

function readWav16(file, startSec, durSec) {
  const b = readFileSync(file);
  let p = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') { dataOff = p + 8; dataLen = Math.min(len, b.length - dataOff); break; }
    p += 8 + len + (len & 1);
  }
  if (!fmt || fmt.sr !== 16000 || fmt.ch !== 1 || fmt.bits !== 16 || fmt.tag !== 1) throw new Error('expected 16 kHz mono 16-bit PCM: ' + JSON.stringify(fmt));
  const total = dataLen / 2;
  const s0 = Math.max(0, Math.floor(startSec * 16000));
  const s1 = Math.min(total, s0 + Math.floor(durSec * 16000));
  const out = new Float32Array(s1 - s0);
  for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(dataOff + (s0 + i) * 2) / 32768;
  return { samples: out, totalSec: total / 16000 };
}

function loadFixture(slug) {
  const dir = path.join(FIX, slug);
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const utt = JSON.parse(readFileSync(path.join(dir, 'transcript.utterances.json'), 'utf8')).utterances;
  const named = new Set(Object.values(m.speakerMap)); // distinct named voices in the confirmed map
  const ref = utt.map((u) => ({ s: u.startMs / 1000, e: u.endMs / 1000, who: m.speakerMap[u.speaker] ?? 'AUD' }));
  return { dir, m, ref, named: named.size, programStart: (m.programStartMs ?? 0) / 1000 };
}

// reference label per 10 ms frame inside [t0, t0+dur); '' = no speech
function refFrames(ref, t0, dur) {
  const n = Math.round(dur / FRAME), f = new Array(n).fill('');
  for (const u of ref) {
    const a = Math.max(0, Math.round((u.s - t0) / FRAME)), b = Math.min(n, Math.round((u.e - t0) / FRAME));
    for (let i = a; i < b; i++) f[i] = u.who;
  }
  return f;
}

function score(segs, rf) {
  const n = rf.length;
  const clusterFrames = new Map(); // cluster -> Uint8Array frame mask
  for (const s of segs) {
    if (!clusterFrames.has(s.speaker)) clusterFrames.set(s.speaker, new Uint8Array(n));
    const m = clusterFrames.get(s.speaker);
    for (let i = Math.max(0, Math.round(s.start / FRAME)); i < Math.min(n, Math.round(s.end / FRAME)); i++) m[i] = 1;
  }
  const refTotal = rf.filter(Boolean).length;
  const info = [];
  for (const [c, m] of clusterFrames) {
    let secs = 0; const over = {}; let inRef = 0;
    for (let i = 0; i < n; i++) if (m[i]) { secs++; if (rf[i]) { inRef++; over[rf[i]] = (over[rf[i]] || 0) + 1; } }
    const top = Object.entries(over).sort((a, b) => b[1] - a[1])[0];
    info.push({ c, secs: secs * FRAME, inRef, top: top?.[0], topShare: top ? top[1] / inRef : 0 });
  }
  const totalInRef = info.reduce((a, x) => a + x.inRef, 0);
  const impure = info.filter((x) => x.topShare < 0.8).reduce((a, x) => a + x.inRef, 0) / (totalInRef || 1);
  const cov = (minSecs) => {
    const ok = new Map(info.filter((x) => x.secs >= minSecs && x.top).map((x) => [x.c, x.top]));
    let good = 0;
    for (let i = 0; i < n; i++) {
      if (!rf[i]) continue;
      for (const [c, who] of ok) if (who === rf[i] && clusterFrames.get(c)[i]) { good++; break; }
    }
    return good / (refTotal || 1);
  };
  return {
    clusters: info.length,
    ge5s: info.filter((x) => x.secs >= 5).length,
    ge10s: info.filter((x) => x.secs >= 10).length,
    ge20s: info.filter((x) => x.secs >= 20).length,
    coverage: cov(0),
    coverageDrop: Object.fromEntries(TINY_SECS.map((t) => [t, cov(t)])),
    impure,
    sizes: info.map((x) => [+x.secs.toFixed(1), x.top, +x.topShare.toFixed(2)]).sort((a, b) => b[0] - a[0]),
  };
}

function pick3min(fx, totalSec) {
  // 180 s window, stepping 30 s inside the program, maximising the third-largest mapped-named speaker's time
  let best = null;
  for (let t = fx.programStart; t + 180 <= totalSec; t += 30) {
    const tot = {};
    for (const u of fx.ref) { const a = Math.max(u.s, t), b = Math.min(u.e, t + 180); if (b > a && u.who !== 'AUD') tot[u.who] = (tot[u.who] || 0) + b - a; }
    const v = Object.values(tot).sort((a, b) => b - a);
    const key = v.length >= 3 ? v[2] : 0;
    if (!best || key > best.key) best = { t, key, tot };
  }
  return best;
}

async function main() {
  if (args['pick-3min']) {
    for (const slug of ['belief-in-god', 'open-source-ai']) {
      const fx = loadFixture(slug);
      const last = fx.ref[fx.ref.length - 1].e;
      console.log(slug, JSON.stringify(pick3min(fx, last)));
    }
    return;
  }
  const fx = loadFixture(args.fixture);
  const start = +args.start, dur = +args.dur, shift = +args.shift;
  const { samples } = readWav16(path.join(fx.dir, 'audio.16k.wav'), start, dur);
  const audioSec = samples.length / 16000;
  const rf = refFrames(fx.ref, start, audioSec);
  const refSecs = rf.filter(Boolean).length * FRAME;
  const configs = [...THRESHOLDS.map((t) => ({ numClusters: -1, threshold: t })), { numClusters: fx.named, threshold: 0.5 }];
  for (const clustering of configs) {
    const sd = sherpa.createOfflineSpeakerDiarization({
      segmentation: { pyannote: { model: path.join(MODELS, 'segmentation.onnx'), windowShiftRatio: shift } },
      embedding: { model: path.join(MODELS, 'embedding.onnx') },
      clustering,
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
    const t0 = performance.now();
    const segs = sd.process(samples);
    const wall = (performance.now() - t0) / 1000;
    if (sd.free) sd.free();
    const r = { fixture: args.fixture, start, dur: audioSec, shift, numClusters: clustering.numClusters, threshold: clustering.numClusters === -1 ? clustering.threshold : null, named: fx.named, refSpeechSecs: +refSecs.toFixed(1), wallSecs: +wall.toFixed(1), rtf: +(wall / audioSec).toFixed(3), ...score(segs, rf) };
    console.log(JSON.stringify({ ...r, sizes: undefined, coverageDrop: undefined }));
    if (args.out) appendFileSync(args.out, JSON.stringify(r) + '\n');
  }
}
main();
