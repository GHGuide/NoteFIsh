// Microphone-only capture processor. Its output channel remains silent so the
// caller never hears their own microphone through the page.
class NoteFishPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.enabled = false;
    this.reset();
    this.port.onmessage = event => { this.enabled = event.data?.enabled === true; this.reset(); };
  }
  reset() {
    this.remaining = this.ratio;
    this.sum = 0;
    this.offset = 0;
    this.buffer = new ArrayBuffer(3200);
    this.view = new DataView(this.buffer);
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!this.enabled || !input) return true;
    for (const sample of input) {
      let available = 1;
      while (available > 0.000001) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining <= 0.000001) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.view.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.offset += 2;
          this.remaining = this.ratio;
          this.sum = 0;
          if (this.offset === 3200) {
            this.port.postMessage(this.buffer, [this.buffer]);
            this.buffer = new ArrayBuffer(3200);
            this.view = new DataView(this.buffer);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('notefish-pcm-capture', NoteFishPcmCapture);
