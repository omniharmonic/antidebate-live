// Streaming box-average resampler. This is the tested reference for the same logic inlined in
// public/worklets/tap.js (an AudioWorklet module cannot import from the app bundle). Keep the two
// in step.
export function createResampler(inRate: number, outRate: number) {
  const ratio = inRate / outRate;
  let carry = new Float32Array(0);
  let pos = 0; // read position inside carry + the next block
  return {
    push(block: Float32Array): number[] {
      const buf = new Float32Array(carry.length + block.length);
      buf.set(carry);
      buf.set(block, carry.length);
      const out: number[] = [];
      while (pos + ratio <= buf.length) {
        const from = Math.floor(pos);
        const to = Math.min(buf.length, Math.max(from + 1, Math.ceil(pos + ratio)));
        let sum = 0;
        for (let i = from; i < to; i++) sum += buf[i]!;
        out.push(sum / (to - from));
        pos += ratio;
      }
      const used = Math.floor(pos);
      carry = buf.slice(used);
      pos -= used;
      return out;
    },
  };
}
