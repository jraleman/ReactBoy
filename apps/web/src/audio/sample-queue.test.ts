import { describe, expect, it } from 'vitest';
import { SampleQueue } from './sample-queue';

const QUANTUM = 128;

/** Interleaved stereo frames: left = start + i, right = -(start + i). */
const ramp = (start: number, frames: number) =>
  Float32Array.from(
    { length: frames * 2 },
    (_, i) => ((i & 1 ? -1 : 1) * (start + (i >> 1))) / 1000,
  );

function pull(queue: SampleQueue) {
  const left = new Float32Array(QUANTUM);
  const right = new Float32Array(QUANTUM);
  queue.pull(left, right);
  return { left, right };
}

describe('SampleQueue', () => {
  it('stays silent until the target is buffered, then plays in order', () => {
    const queue = new SampleQueue(256);
    queue.push(ramp(0, 200));
    expect(pull(queue).left.every((v) => v === 0)).toBe(true);
    queue.push(ramp(200, 56));
    const { left, right } = pull(queue);
    expect(left[0]).toBeCloseTo(0);
    expect(left[10]).toBeCloseTo(0.01);
    expect(right[10]).toBeCloseTo(-0.01);
  });

  it('plays faster when over target and slower when under, by at most 0.5%', () => {
    const over = new SampleQueue(1000);
    over.push(ramp(0, 2000));
    const fast = pull(over).left;
    const under = new SampleQueue(1000);
    under.push(ramp(0, 1000));
    pull(under); // start playing, then let it drain below target
    const slow = pull(under).left;
    const step = (out: Float32Array) => (out[QUANTUM - 1]! - out[0]!) / (QUANTUM - 1);
    expect(step(fast) * 1000).toBeGreaterThan(1.004);
    expect(step(fast) * 1000).toBeLessThanOrEqual(1.005 + 1e-6);
    expect(step(slow) * 1000).toBeLessThan(1);
    expect(step(slow) * 1000).toBeGreaterThan(0.995);
  });

  it('fades out instead of cutting off when it runs dry, then buffers again', () => {
    const queue = new SampleQueue(128);
    queue.push(new Float32Array(130 * 2).fill(0.5));
    pull(queue);
    const { left } = pull(queue);
    expect(left[0]).toBeCloseTo(0.5);
    expect(left[QUANTUM - 1]).toBeGreaterThan(0.2);
    expect(left[QUANTUM - 1]).toBeLessThan(0.5);
    queue.push(new Float32Array(10 * 2).fill(0.5));
    expect(pull(queue).left[0]).toBeLessThan(left[QUANTUM - 1]!);
  });

  it('skips ahead to the target latency when far behind', () => {
    const queue = new SampleQueue(100);
    queue.push(ramp(0, 1000));
    expect(queue.size).toBe(100);
    expect(pull(queue).left[0]).toBeCloseTo(0.9);
  });

  it('drops everything on clear', () => {
    const queue = new SampleQueue(100);
    queue.push(ramp(0, 150));
    queue.clear();
    expect(queue.size).toBe(0);
    expect(pull(queue).left.every((v) => v === 0)).toBe(true);
  });
});
