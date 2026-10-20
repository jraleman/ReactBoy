import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PALETTES } from '@reactboy/core';
import { EmulatorContext } from '../../hooks/useEmulator';
import { MemoryStore } from '../../storage/store';
import { EmulatorClient } from '../../worker/client';
import Debugger from './Debugger';

/** A valid ROM header around `program` at 0x0100. */
function makeRom(program: number[]): Uint8Array {
  const rom = new Uint8Array(0x8000);
  rom.set(program, 0x100);
  let checksum = 0;
  for (let addr = 0x134; addr <= 0x14c; addr++) checksum = (checksum - rom[addr]! - 1) & 0xff;
  rom[0x14d] = checksum;
  return rom;
}

/** loop: INC A; JR loop */
const loopRom = makeRom([0x3c, 0x18, 0xfd]);

async function setup() {
  const client = new EmulatorClient({ store: new MemoryStore() });
  await client.loadRom(new Blob([loopRom.slice()]));
  await vi.waitFor(() => expect(client.getSnapshot().status).toBe('running'));
  client.pause();
  const onClose = vi.fn();
  render(
    <EmulatorContext.Provider value={client}>
      <Debugger palette={PALETTES.classic} onClose={onClose} autoFocus />
    </EmulatorContext.Provider>,
  );
  await screen.findByText(/^Paused at \$01/);
  return { client, onClose };
}

describe('Debugger', () => {
  it('sets breakpoints from the disassembly and steps', async () => {
    const { client, onClose } = await setup();
    expect(screen.getByRole('heading', { name: 'Debugger' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Breakpoint at $0101' }));
    expect(client.getDebugSnapshot().breakpoints).toEqual([{ addr: 0x101, bank: null }]);
    expect(screen.getByRole('button', { name: 'Breakpoint at $0101' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '$0101' })).toBeInTheDocument();

    const pc = client.getDebugSnapshot().snapshot!.pc;
    fireEvent.click(screen.getByRole('button', { name: 'Step' }));
    await vi.waitFor(() => expect(client.getDebugSnapshot().snapshot!.pc).not.toBe(pc));
    expect(screen.getByText(/^Paused at \$01/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    client.dispose();
  });

  it('switches views with the arrow keys and adds watchpoints by address', async () => {
    const { client } = await setup();
    const cpuTab = screen.getByRole('tab', { name: 'CPU' });
    act(() => cpuTab.focus());
    fireEvent.keyDown(cpuTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Memory' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'I/O' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('LCDC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'CPU' }));
    const field = screen.getByRole('textbox', { name: 'Add to watchpoints' });
    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.submit(field);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a hex address');
    fireEvent.change(field, { target: { value: '$C000' } });
    fireEvent.submit(field);
    expect(client.getDebugSnapshot().watchpoints).toEqual([
      { addr: 0xc000, read: false, write: true },
    ]);

    // Reads can be added; the last kind left can't be switched off.
    fireEvent.click(screen.getByRole('button', { name: 'Stop on reads of $C000' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop on writes of $C000' }));
    expect(client.getDebugSnapshot().watchpoints).toEqual([
      { addr: 0xc000, read: true, write: false },
    ]);
    expect(screen.getByRole('button', { name: 'Stop on reads of $C000' })).toBeDisabled();
    client.dispose();
  });

  it('loads a symbol file, labels the disassembly and takes labels as addresses', async () => {
    const { client } = await setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['garbage'], 'bad.sym')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No symbols in bad.sym');

    const sym = '; rgblink\n00:0100 Loop\n00:c000 wCount\n';
    fireEvent.change(input, { target: { files: [new File([sym], 'loop.sym')] } });
    expect(await screen.findByText('Symbols: loop.sym (2)')).toBeInTheDocument();
    expect(screen.getByText('Loop:')).toBeInTheDocument();
    expect(screen.getByText('JR Loop')).toBeInTheDocument();

    const field = screen.getByRole('textbox', { name: 'Add to breakpoints' });
    fireEvent.change(field, { target: { value: 'loop' } });
    fireEvent.submit(field);
    expect(client.getDebugSnapshot().breakpoints).toEqual([{ addr: 0x100, bank: null }]);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await screen.findByText('No symbols loaded');
    client.dispose();
  });

  it('edits memory while paused and reports writes the hardware ignores', async () => {
    const { client } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    const goTo = (addr: string) => {
      const field = screen.getByRole('textbox', { name: 'Go to address' });
      fireEvent.change(field, { target: { value: addr } });
      fireEvent.submit(field);
    };
    const set = (addr: string, value: string) => {
      const field = screen.getByRole('textbox', { name: `New value for $${addr}` });
      fireEvent.change(field, { target: { value } });
      fireEvent.submit(field);
    };

    goTo('0100');
    expect(screen.getByText('ROM can’t be edited.')).toBeInTheDocument();

    goTo('C000');
    set('C000', '42');
    expect(await screen.findByText('Set to $42.')).toBeInTheDocument();
    expect(client.getDebugSnapshot().snapshot!.memory[0xc000]).toBe(0x42);

    goTo('FF44'); // LY is read-only
    set('FF44', '99');
    expect(await screen.findByText(/^Wrote \$99, but it reads/)).toBeInTheDocument();
    client.dispose();
  });
});
