import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PALETTES } from '@reactboy/core';
import { EmulatorContext, useEmulatorClient, useEmulatorState } from '../../hooks/useEmulator';
import type { ShellTheme } from '../../hooks/useSettings';
import { MemoryStore } from '../../storage/store';
import { EmulatorClient } from '../../worker/client';
import { GameBoyShell } from './GameBoyShell';
import { TOUR, usePartsView } from './partsView';

/** loop: INC A; JR loop, in a valid header. */
function loopRom(): Uint8Array<ArrayBuffer> {
  const rom = new Uint8Array(0x8000);
  rom.set([0x3c, 0x18, 0xfd], 0x100);
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}

/** The shell wired up as App does it, with a real client. */
function Harness({ theme, cardSlot }: { theme: ShellTheme; cardSlot: HTMLElement | null }) {
  const { status } = useEmulatorState();
  const client = useEmulatorClient();
  const view = usePartsView();
  const [contrast, setContrast] = useState(0.5);
  return (
    <>
      <button type="button" onClick={view.startTour}>
        Take the tour
      </button>
      <GameBoyShell
        scale={2}
        theme={theme}
        palette={PALETTES.classic}
        powered={status === 'running' || status === 'paused'}
        canPower
        onPower={(on) => client.setPower(on)}
        contrast={contrast}
        onContrast={setContrast}
        view={view}
        screen={null}
        dpad={null}
        actions={null}
        menu={null}
        cardSlot={cardSlot}
      />
    </>
  );
}

async function setup(theme: ShellTheme, cardSlot: HTMLElement | null = null) {
  const client = new EmulatorClient({ store: new MemoryStore() });
  await client.loadRom(new Blob([loopRom()]));
  await vi.waitFor(() => expect(client.getSnapshot().status).toBe('running'));
  client.pause();
  const shell = (current: ShellTheme) => (
    <EmulatorContext.Provider value={client}>
      <Harness theme={current} cardSlot={cardSlot} />
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
    // The board lights up from cheap counters, so memory copies stop with the card.
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

  it('walks through the parts in the tour, and finishes back where it started', async () => {
    const { client } = await setup(
      'teal',
      document.body.appendChild(document.createElement('div')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(screen.getByRole('dialog', { name: 'Cartridge slot & MBC' })).toHaveTextContent(
      `1 of ${TOUR.length}`,
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Crystal oscillator' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crystal oscillator' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (let step = 2; step < TOUR.length; step++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Power regulator' })).toHaveFocus();
    // Opening a part by hand isn't part of the tour.
    fireEvent.click(screen.getByRole('button', { name: 'CPU (DMG-CPU)' }));
    expect(screen.queryByRole('navigation', { name: 'Tour' })).toBeNull();
    client.dispose();
  });

  it('starts the phone sheet short, with more on request', async () => {
    const { client } = await setup('red');
    fireEvent.click(screen.getByRole('button', { name: 'Work RAM' }));
    const more = screen.getByRole('button', { name: 'More' });
    expect(screen.getByRole('dialog')).toHaveTextContent('8 KiB of scratch memory');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog')).toHaveTextContent('$C000–$DFFF');
    client.dispose();
  });

  it('switches the power off and back on, and turns the contrast wheel', async () => {
    const { client } = await setup('grey');
    const power = screen.getByRole('switch', { name: 'Power' });
    expect(power).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(power);
    expect(client.getSnapshot().status).toBe('off');
    expect(power).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(power);
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('running'));

    const wheel = screen.getByRole('slider', { name: 'Contrast wheel' });
    fireEvent.change(wheel, { target: { value: '80' } });
    expect(wheel).toHaveAttribute('aria-valuetext', '80%');
    client.dispose();
  });
});
