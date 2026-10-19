import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PALETTES } from '@reactboy/core';
import { EmulatorContext } from '../../hooks/useEmulator';
import type { ShellTheme } from '../../hooks/useSettings';
import { MemoryStore } from '../../storage/store';
import { EmulatorClient } from '../../worker/client';
import { GameBoyShell } from './GameBoyShell';

/** loop: INC A; JR loop, in a valid header. */
function loopRom(): Uint8Array<ArrayBuffer> {
  const rom = new Uint8Array(0x8000);
  rom.set([0x3c, 0x18, 0xfd], 0x100);
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}

async function setup(theme: ShellTheme, cardSlot: HTMLElement | null = null) {
  const client = new EmulatorClient({ store: new MemoryStore() });
  await client.loadRom(new Blob([loopRom()]));
  await vi.waitFor(() => expect(client.getSnapshot().status).toBe('running'));
  client.pause();
  const shell = (current: ShellTheme) => (
    <EmulatorContext.Provider value={client}>
      <GameBoyShell
        scale={2}
        theme={current}
        palette={PALETTES.classic}
        powered
        screen={null}
        dpad={null}
        actions={null}
        menu={null}
        cardSlot={cardSlot}
      />
    </EmulatorContext.Provider>
  );
  const view = render(shell(theme));
  return { client, rerender: (next: ShellTheme) => view.rerender(shell(next)) };
}

describe('GameBoyShell', () => {
  it('keeps the grey case solid, with nothing inside to inspect', async () => {
    const { client } = await setup('grey');
    expect(screen.queryByRole('group', { name: 'Parts inside the case' })).toBeNull();
    client.dispose();
  });

  it('explains a part of a clear case with live values, and closes with Escape', async () => {
    const { client, rerender } = await setup('purple');
    const cpu = screen.getByRole('button', { name: 'CPU (DMG-CPU)' });
    fireEvent.click(cpu);

    const card = screen.getByRole('dialog', { name: 'CPU (DMG-CPU)' });
    expect(cpu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'CPU (DMG-CPU)' })).toHaveFocus();
    // The paused machine is inspected without opening the debugger.
    expect(await screen.findByText(/^\$01/)).toBeInTheDocument();
    expect(card).toHaveTextContent('Paused');
    expect(client.getDebugSnapshot().open).toBe(false);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cpu).toHaveFocus();
    expect(client.getProbeSnapshot().snapshot).toBeNull();

    // Without room beside the device, it covers the controls, not the screen.
    fireEvent.click(cpu);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'sheet');
    fireEvent.click(cpu);

    // Changing to the solid case closes whatever was open.
    fireEvent.click(screen.getByRole('button', { name: 'Video RAM' }));
    act(() => rerender('grey'));
    expect(screen.queryByRole('dialog')).toBeNull();
    client.dispose();
  });

  it('puts the explainer beside the device when given a place for it', async () => {
    const slot = document.body.appendChild(document.createElement('div'));
    const { client } = await setup('smoke', slot);
    fireEvent.click(screen.getByRole('button', { name: 'Link port' }));
    const card = screen.getByRole('dialog', { name: 'Link port' });
    expect(slot).toContainElement(card);
    expect(card).toHaveAttribute('data-placement', 'side');
    client.dispose();
    slot.remove();
  });
});
