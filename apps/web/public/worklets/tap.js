// apps/web/public/worklets/tap.js — posts 20 ms, 16 kHz frames per input channel.
// Each output sample is the box average of the input window it covers, which limits aliasing.
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.acc = []; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    input.forEach((ch, c) => {
      const acc = (this.acc[c] ||= { pos: 0, out: [] });
      for (; acc.pos + this.ratio <= ch.length; acc.pos += this.ratio) {
        const from = Math.floor(acc.pos), to = Math.min(ch.length, Math.max(from + 1, Math.floor(acc.pos + this.ratio)));
        let sum = 0;
        for (let i = from; i < to; i++) sum += ch[i];
        acc.out.push(sum / (to - from));
      }
      acc.pos -= ch.length;
      while (acc.out.length >= 320) this.port.postMessage({ channel: c, frame: Float32Array.from(acc.out.splice(0, 320)) });
    });
    return true;
  }
}
registerProcessor('tap', Tap);
