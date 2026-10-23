import workletUrl from './audio.worklet.ts?worker&url';
import type { AudioMessage } from './audio.worklet';

/** Safari 17+ lets pages opt out of the iPhone ring/silent switch muting web audio. */
interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * The page's sound output: an AudioContext feeding emulator samples through an AudioWorklet
 * and a volume control. Browsers only allow audio after a user gesture, so it starts on the
 * first {@link unlock} call made from one.
 */
export class AudioOutput {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private volume = 1;

  /** Called with true once sound can play, and false if it never will. */
  constructor(private readonly onReady: (ready: boolean) => void) {}

  /** Device sample rate once running, 0 before. */
  get sampleRate(): number {
    return this.node && this.context?.state === 'running' ? this.context.sampleRate : 0;
  }

  /** Must first be called from a user gesture (click, key press, touch). */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      return this.onReady(false);
    }
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) session.type = 'playback';
    // Created synchronously inside the gesture, which iOS requires.
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    void context.resume();
    context.onstatechange = () => this.onReady(this.sampleRate > 0);
    context.audioWorklet.addModule(workletUrl).then(
      () => {
        const node = new AudioWorkletNode(context, 'reactboy-audio', {
          numberOfInputs: 0,
          outputChannelCount: [2],
        });
        const gain = context.createGain();
        gain.gain.value = this.volume;
        node.connect(gain).connect(context.destination);
        this.node = node;
        this.gain = gain;
        this.onReady(this.sampleRate > 0);
      },
      () => this.onReady(false),
    );
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.context && this.gain) {
      // A short ramp avoids zipper noise while dragging the slider.
      this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.015);
    }
  }

  /** Queues interleaved stereo samples at {@link sampleRate}. Takes ownership of the buffer. */
  push(samples: Float32Array): void {
    this.post(samples, [samples.buffer as ArrayBuffer]);
  }

  /** Drops queued sound, e.g. on switching games. */
  clear(): void {
    this.post('clear');
  }

  /**
   * The boot "ding": a short square-wave C6 then a ringing C7, as the hardware plays them.
   * Silent until sound is unlocked; follows the volume.
   */
  chime(): void {
    const { context, gain } = this;
    if (!context || !gain || context.state !== 'running') return;
    const start = context.currentTime;
    for (const [hz, at, length] of [
      [1048.6, 0, 0.07],
      [2097.2, 0.07, 0.9],
    ] as const) {
      const tone = context.createOscillator();
      const envelope = context.createGain();
      tone.type = 'square';
      tone.frequency.value = hz;
      envelope.gain.setValueAtTime(0.12, start + at);
      envelope.gain.exponentialRampToValueAtTime(0.001, start + at + length);
      tone.connect(envelope).connect(gain);
      tone.start(start + at);
      tone.stop(start + at + length);
    }
  }

  close(): void {
    void this.context?.close();
  }

  private post(message: AudioMessage, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(message, transfer);
  }
}
