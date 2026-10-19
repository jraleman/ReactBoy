/** Largest playback-rate change used to steer the fill level, well below audible pitch shift. */
const MAX_SKEW = 0.005;
/** Per-sample decay towards silence when the queue runs dry, so stopping doesn't click. */
const FADE = 0.995;

/**
 * Stereo sample FIFO between the emulator (bursty, one batch per animation frame) and the
 * audio device (steady 128-frame quanta). It keeps about `target` frames queued by playing
 * up to 0.5% faster or slower, linearly interpolating between samples, and pre-buffers back
 * up to `target` after running dry (e.g. while paused) before playing again.
 */
export class SampleQueue {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly mask: number;
  /** Frames written and the (fractional) read position, both counted since creation. */
  private written = 0;
  private position = 0;
  private buffering = true;
  private lastLeft = 0;
  private lastRight = 0;

  /**
   * @param target frames to keep queued (the added latency)
   * @param capacity ring size in frames, rounded up to a power of two
   */
  constructor(
    private readonly target: number,
    capacity = target * 8,
  ) {
    const size = 2 ** Math.ceil(Math.log2(Math.max(capacity, target * 4)));
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
    this.mask = size - 1;
  }

  /** Frames queued and not yet played. */
  get size(): number {
    return this.written - Math.floor(this.position);
  }

  /** Appends interleaved stereo samples. */
  push(samples: Float32Array): void {
    const frames = samples.length >> 1;
    for (let i = 0; i < frames; i++) {
      const index = (this.written + i) & this.mask;
      this.left[index] = samples[i * 2]!;
      this.right[index] = samples[i * 2 + 1]!;
    }
    this.written += frames;
    // Far behind (a stalled tab, a burst of catch-up frames): skip to the target latency.
    if (this.size > Math.min(this.target * 3, this.mask)) {
      this.position = this.written - this.target;
    }
  }

  /** Fills one render quantum per channel. */
  pull(outLeft: Float32Array, outRight: Float32Array): void {
    if (this.buffering && this.size >= this.target) this.buffering = false;
    let i = 0;
    if (!this.buffering) {
      const error = Math.max(-1, Math.min(1, (this.size - this.target) / this.target));
      const step = 1 + error * MAX_SKEW;
      for (; i < outLeft.length; i++) {
        const index = Math.floor(this.position);
        // Interpolation needs the next frame too.
        if (this.written - index < 2) {
          this.buffering = true;
          break;
        }
        const frac = this.position - index;
        const a = index & this.mask;
        const b = (index + 1) & this.mask;
        this.lastLeft = this.left[a]! + (this.left[b]! - this.left[a]!) * frac;
        this.lastRight = this.right[a]! + (this.right[b]! - this.right[a]!) * frac;
        outLeft[i] = this.lastLeft;
        outRight[i] = this.lastRight;
        this.position += step;
      }
    }
    for (; i < outLeft.length; i++) {
      this.lastLeft *= FADE;
      this.lastRight *= FADE;
      outLeft[i] = this.lastLeft;
      outRight[i] = this.lastRight;
    }
  }

  /** Drops everything queued, e.g. when the game changes. */
  clear(): void {
    this.position = this.written;
    this.buffering = true;
  }
}
