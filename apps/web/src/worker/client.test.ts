import { describe, expect, it } from 'vitest';
import { Button } from '@reactboy/core';
import { EmulatorClient } from './client';

describe('EmulatorClient', () => {
  it('falls back to the main thread when workers are unavailable', () => {
    expect(new EmulatorClient().getSnapshot()).toMatchObject({ status: 'empty', inline: true });
  });

  it('keeps a button held until every source releases it', () => {
    const client = new EmulatorClient();
    client.setButton('keyboard', Button.A, true);
    client.setButton('touch', Button.A, true);
    client.setButton('keyboard', Button.A, false);
    expect(client.getSnapshot().pressed).toBe(1 << Button.A);
    client.setButton('touch', Button.A, false);
    expect(client.getSnapshot().pressed).toBe(0);
  });

  it('reports unreadable files as an error state', async () => {
    const client = new EmulatorClient();
    await client.loadRom(new Blob([new Uint8Array(16)]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getSnapshot()).toMatchObject({ status: 'error' });
    expect(client.getSnapshot().error).toMatch(/too small/);
  });
});

describe('EmulatorClient with a game loaded', () => {
  it('keeps playing when a bad file is loaded on top', async () => {
    const client = new EmulatorClient();
    await client.loadRom(new Blob([new Uint8Array(0x8000)]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getSnapshot()).toMatchObject({ status: 'running', error: null });

    await client.loadRom(new Blob([new Uint8Array(16)]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getSnapshot().status).toBe('running');
    expect(client.getSnapshot().header?.title).toBe('UNTITLED');
    expect(client.getSnapshot().error).toMatch(/too small/);
    client.dispose();
  });
});
