import { describe, expect, it } from 'vitest';
import { Apu } from '../src/apu/apu';
import { CLOCK_HZ } from '../src/constants';

const RATE = 48_000;
const M_CYCLES_PER_SEQUENCER_STEP = CLOCK_HZ / 512 / 4;

/** Runs the APU on its own for `seconds`, returning interleaved stereo samples. */
function run(apu: Apu, seconds: number): Float32Array {
  const out: number[] = [];
  const cycles = Math.round((CLOCK_HZ / 4) * seconds);
  for (let i = 1; i <= cycles; i++) {
    apu.tick();
    if (i % M_CYCLES_PER_SEQUENCER_STEP === 0) apu.clockFrameSequencer();
    if (i % 4096 === 0) out.push(...apu.takeSamples());
  }
  out.push(...apu.takeSamples());
  return Float32Array.from(out);
}

const channel = (samples: Float32Array, side: 0 | 1) => samples.filter((_, i) => i % 2 === side);
const peak = (samples: Float32Array) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
const crossings = (samples: Float32Array) =>
  samples.reduce(
    (n, v, i) => (i > 0 && Math.sign(v) !== Math.sign(samples[i - 1]!) ? n + 1 : n),
    0,
  );

/** Channel 1 playing a ~1 kHz 50% square at full volume, panned per `panning`. */
function squareApu(panning = 0x11): Apu {
  const apu = new Apu();
  apu.setSampleRate(RATE);
  apu.write(0xff24, 0x77); // NR50: full volume both sides
  apu.write(0xff25, panning); // NR51
  apu.write(0xff11, 0x80); // NR11: 50% duty
  apu.write(0xff12, 0xf0); // NR12: volume 15, no envelope
  apu.write(0xff13, 0x7d); // NR13/NR14: frequency 1917 -> 131072 / 131 = 1000.5 Hz, trigger
  apu.write(0xff14, 0x87);
  return apu;
}

describe('APU output', () => {
  it('produces nothing until a sample rate is set', () => {
    const apu = new Apu();
    apu.tick();
    expect(apu.takeSamples()).toHaveLength(0);
  });

  it('plays a square wave at the programmed pitch and sample rate', () => {
    const samples = run(squareApu(), 0.5);
    expect(samples.length / 2).toBeCloseTo(RATE / 2, -1);
    const left = channel(samples, 0);
    // Two zero crossings per cycle of a 1000.5 Hz tone over 0.5 s.
    expect(crossings(left.subarray(RATE / 10))).toBeGreaterThan(790);
    expect(crossings(left.subarray(RATE / 10))).toBeLessThan(810);
    expect(peak(left)).toBeGreaterThan(0.2);
    expect(channel(samples, 1)).toEqual(left);
  });

  it('pans channels with NR51', () => {
    const samples = run(squareApu(0x10), 0.1); // channel 1 left only
    expect(peak(channel(samples, 0))).toBeGreaterThan(0.2);
    expect(peak(channel(samples, 1))).toBe(0);
  });

  it('mutes channels left out of the channel mask', () => {
    const apu = squareApu();
    apu.channelMask = 0b1110;
    expect(peak(run(apu, 0.1))).toBe(0);
  });

  it('blocks DC, so an enabled DAC with nothing playing settles to silence', () => {
    const apu = new Apu();
    apu.setSampleRate(RATE);
    apu.write(0xff25, 0xff);
    apu.write(0xff12, 0x08); // DAC on, volume 0: a constant analog level
    const samples = run(apu, 1);
    expect(peak(samples.subarray(-200))).toBeLessThan(0.001);
  });

  it('stops after the length counter runs out', () => {
    const apu = squareApu();
    apu.write(0xff11, 0x80 | 0x3f); // length 1 / 256 s
    apu.write(0xff14, 0xc7); // retrigger with length enabled
    run(apu, 0.02);
    expect(apu.read(0xff26) & 0x01).toBe(0);
  });
});
