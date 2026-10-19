import { SampleQueue } from './sample-queue';

// The app is type-checked against the DOM lib; declare just the AudioWorklet surface used here.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

/** Latency kept queued: covers a couple of late animation frames without underrunning. */
const TARGET_SECONDS = 0.06;

export type AudioMessage = Float32Array | 'clear';

/** Plays emulator samples posted to its port as interleaved stereo Float32Arrays. */
class EmulatorAudioProcessor extends AudioWorkletProcessor {
  private readonly queue = new SampleQueue(Math.round(sampleRate * TARGET_SECONDS));

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<AudioMessage>) => {
      if (event.data === 'clear') this.queue.clear();
      else this.queue.push(event.data);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0] ?? [];
    if (left) this.queue.pull(left, right ?? new Float32Array(left.length));
    return true;
  }
}

registerProcessor('reactboy-audio', EmulatorAudioProcessor);
