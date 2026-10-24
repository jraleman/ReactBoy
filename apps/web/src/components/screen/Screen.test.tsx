import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PALETTES } from '@reactboy/core';
import { EmulatorContext } from '../../hooks/useEmulator';
import { MemoryStore } from '../../storage/store';
import { EmulatorClient } from '../../worker/client';
import { Screen } from './Screen';

/** loop: INC A; JR loop, in a valid header. */
function loopRom(): Uint8Array<ArrayBuffer> {
  const rom = new Uint8Array(0x8000);
  rom.set([0x3c, 0x18, 0xfd], 0x100);
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}

function setup(intro = false) {
  const client = new EmulatorClient({ store: new MemoryStore() });
  const chime = vi.spyOn(client, 'chime');
  const view = (playing: boolean) => (
    <EmulatorContext.Provider value={client}>
      <Screen palette={PALETTES.classic} intro={playing} />
    </EmulatorContext.Provider>
  );
  const { container, rerender } = render(view(intro));
  const boot = () => container.querySelector('[data-power]');
  const start = async () => {
    await act(() => client.loadRom(new Blob([loopRom()])));
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('running'));
  };
  return { client, chime, boot, start, endIntro: () => rerender(view(false)) };
}

describe('Screen boot', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rests on the boot logo with no game', () => {
    const { client, boot } = setup();
    expect(
      screen.getByText('Drop a .gb or .gbc file here, or choose Load ROM.'),
    ).toBeInTheDocument();
    expect(boot()).toBeNull();
    client.dispose();
  });

  it('boots a game behind the logo, chiming as it lands, but not when resumed', async () => {
    const { client, chime, boot, start } = setup();
    await start();
    expect(boot()).not.toBeNull();
    await vi.waitFor(() => expect(boot()).toBeNull(), { timeout: 3000 });
    expect(chime).toHaveBeenCalledOnce();

    act(() => client.pause());
    act(() => client.play());
    expect(boot()).toBeNull();

    // Switched off and on again, it boots afresh.
    act(() => client.setPower(false));
    act(() => client.setPower(true));
    await vi.waitFor(() => expect(boot()).not.toBeNull());
    client.dispose();
  });

  it('leaves a game started during the intro to the intro', async () => {
    const { client, boot, start, endIntro } = setup(true);
    await start();
    expect(boot()).toBeNull();
    expect(screen.getByText('ReactBoy')).toBeInTheDocument();
    endIntro();
    expect(screen.queryByText('ReactBoy')).toBeNull();
    client.dispose();
  });
});
