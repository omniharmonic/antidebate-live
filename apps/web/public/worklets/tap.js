// apps/web/public/worklets/tap.js — posts 20 ms, 16 kHz frames per input channel.
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = []; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    input.forEach((ch, c) => {
      const acc = (this.acc[c] ||= { pos: 0, out: [] });
      for (; acc.pos < ch.length; acc.pos += this.ratio) acc.out.push(ch[Math.floor(acc.pos)]);
      acc.pos -= ch.length;
      while (acc.out.length >= 320) this.port.postMessage({ channel: c, frame: Float32Array.from(acc.out.splice(0, 320)) });
    });
    return true;
  }
}
registerProcessor('tap', Tap);
