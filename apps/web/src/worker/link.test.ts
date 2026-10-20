import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkCable, type Channel, type LinkStatus, type Port } from './link';

/** Channels on one hub hear each other's messages (not their own), as BroadcastChannel does. */
function hub() {
  const channels = new Set<Channel>();
  return (): Channel => {
    const channel: Channel = {
      onmessage: null,
      postMessage: (data) => {
        if (!channels.has(channel)) return; // closed
        queueMicrotask(() => {
          for (const other of channels) {
            if (other !== channel) other.onmessage?.({ data } as MessageEvent);
          }
        });
      },
      close: () => channels.delete(channel),
    };
    channels.add(channel);
    return channel;
  };
}

/** A window's game, recording what reaches its serial port. */
function window(open: () => Channel, clock: { now: number }) {
  const statuses: LinkStatus[] = [];
  const received: string[] = [];
  const port: Port = {
    link: null,
    receive: (byte) => received.push(`byte ${byte}`),
    receiveReply: (byte) => received.push(`reply ${byte}`),
  };
  const cable = new LinkCable(
    (s) => statuses.push(s),
    open,
    () => clock.now,
  );
  cable.plug(port);
  return { cable, port, received, statuses };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('LinkCable', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pairs two windows and carries a transfer between their games', async () => {
    const open = hub();
    const clock = { now: 0 };
    const a = window(open, clock);
    const b = window(open, clock);
    a.cable.setEnabled(true);
    expect(a.cable.status).toBe('waiting');
    b.cable.setEnabled(true);
    await settle();
    expect([a.cable.status, b.cable.status]).toEqual(['connected', 'connected']);

    a.port.link!.send(0x42);
    await settle();
    b.port.link!.reply(0x99);
    await settle();
    expect([a.received, b.received]).toEqual([['reply 153'], ['byte 66']]);
    expect(a.statuses).toEqual(['waiting', 'connected']);
  });

  it('keeps a third window waiting, and lets it in when one leaves', async () => {
    const open = hub();
    const clock = { now: 0 };
    const [a, b, c] = [window(open, clock), window(open, clock), window(open, clock)];
    a.cable.setEnabled(true);
    b.cable.setEnabled(true);
    await settle();
    c.cable.setEnabled(true);
    await settle();
    expect(c.cable.status).toBe('waiting');

    b.cable.setEnabled(false);
    await settle();
    expect(a.cable.status).toBe('waiting');
    // The next heartbeat's hello pairs the two that are left.
    clock.now += 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect([a.cable.status, c.cable.status]).toEqual(['connected', 'connected']);
    expect(b.port.link).toBeNull();
  });

  it('notices a partner that went away without saying so', async () => {
    const open = hub();
    const clock = { now: 0 };
    const a = window(open, clock);
    const b = window(open, clock);
    a.cable.setEnabled(true);
    b.cable.setEnabled(true);
    await settle();
    // B's window is closed: its heartbeat stops, and nothing says bye.
    b.cable['channel']!.close();
    clock.now += 4000;
    await vi.advanceTimersByTimeAsync(4000);
    expect(a.cable.status).toBe('waiting');
    expect(a.port.link).toBeNull();
  });
});
