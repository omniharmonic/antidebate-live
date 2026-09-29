// apps/web/public/worklets/tap.js — posts 20 ms, 16 kHz frames per input channel.
// The resampler is a copy of createResampler in lib/live/resample.ts (the tested reference), inlined
// because a worklet module cannot import from the app bundle. Keep the two in step.
function createResampler(inRate, outRate) {
  const ratio = inRate / outRate;
  let carry = new Float32Array(0);
  let pos = 0;
  return {
    push(block) {
      const buf = new Float32Array(carry.length + block.length);
      buf.set(carry);
      buf.set(block, carry.length);
      const out = [];
      while (pos + ratio <= buf.length) {
        const from = Math.floor(pos);
        const to = Math.min(buf.length, Math.max(from + 1, Math.ceil(pos + ratio)));
        let sum = 0;
        for (let i = from; i < to; i++) sum += buf[i];
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

class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.rs = []; this.out = []; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    input.forEach((ch, c) => {
      const rs = (this.rs[c] ||= createResampler(sampleRate, 16000));
      const out = (this.out[c] ||= []);
      for (const x of rs.push(ch)) out.push(x);
      while (out.length >= 320) this.port.postMessage({ channel: c, frame: Float32Array.from(out.splice(0, 320)) });
    });
    return true;
  }
}
registerProcessor('tap', Tap);
