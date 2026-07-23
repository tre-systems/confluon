/**
 * Lossless recording tap. Buffers the stereo master feed in ~0.34 s blocks and
 * posts them to the main thread, where they are assembled into a WAV file.
 */
class ConfluenceRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.blockSize = 16384;
    this.left = new Float32Array(this.blockSize);
    this.right = new Float32Array(this.blockSize);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data === "start") {
        this.recording = true;
      } else if (event.data === "stop") {
        this.recording = false;
        this.flush();
      }
    };
  }

  flush() {
    if (this.filled === 0) return;
    this.port.postMessage({
      left: this.left.slice(0, this.filled),
      right: this.right.slice(0, this.filled),
    });
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.recording || !input || input.length === 0) return true;
    const left = input[0];
    const right = input[1] ?? input[0];
    if (!left) return true;
    for (let index = 0; index < left.length; index += 1) {
      this.left[this.filled] = left[index];
      this.right[this.filled] = right[index];
      this.filled += 1;
      if (this.filled === this.blockSize) this.flush();
    }
    return true;
  }
}

registerProcessor("confluence-recorder", ConfluenceRecorder);
