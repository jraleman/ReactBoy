import { describe, expect, it } from 'vitest';
import { GameBoy, SaveStateError } from '../src';
import { makeRom } from './helpers/rom-builder';
import { loadRom, romPath } from './helpers/roms';

const T0 = 1_700_000_000_000;

/** Enables cartridge RAM, writes `value` to 0xA000, then spins. */
const ramWriter = (value: number) => [
  ...[0x3e, 0x0a, 0xea, 0x00, 0x00], // LD A,0x0A; LD (0x0000),A
  ...[0x3e, value, 0xea, 0x00, 0xa0], // LD A,value; LD (0xA000),A
  ...[0x18, 0xfe], // JR -2
];

/** Mixes a WRAM counter, DIV and TIMA into WRAM and the scroll register, so frames differ. */
const busy = makeRom([
  ...[0x3e, 0x91, 0xe0, 0x40], // LD A,0x91; LDH (LCDC),A
  ...[0x3e, 0x05, 0xe0, 0x07], // LD A,0x05; LDH (TAC),A
  ...[0x21, 0x00, 0xc0], // LD HL,0xC000
  0x34, // loop: INC (HL)
  ...[0xf0, 0x04], // LDH A,(DIV)
  0x86, // ADD A,(HL)
  ...[0xe0, 0x43], // LDH (SCX),A
  ...[0xf0, 0x05], // LDH A,(TIMA)
  ...[0xea, 0x01, 0xc0], // LD (0xC001),A
  ...[0x18, 0xf3], // JR loop
]);

describe('save states', () => {
  it('round-trips the whole machine and continues identically', () => {
    const a = new GameBoy(busy);
    for (let i = 0; i < 30; i++) a.runFrame();
    a.step();
    const state = a.serialize(T0);

    const b = new GameBoy(busy);
    b.deserialize(state, T0);
    expect(b.serialize(T0)).toEqual(state);
    expect(b.framebuffer).toEqual(a.framebuffer);

    for (let i = 0; i < 10; i++) {
      a.runFrame();
      b.runFrame();
    }
    expect(b.cycles).toBe(a.cycles);
    expect(b.cpu.pc).toBe(a.cpu.pc);
    expect(b.serialize(T0)).toEqual(a.serialize(T0));
  });

  it('round-trips the sound hardware mid-note', () => {
    // Register/value pairs, each written with LDH (n),A: all four channels playing, with sweep,
    // noise and a waveform whose samples all differ.
    const waveform = Array.from({ length: 16 }, (_, i) => [0x30 + i, (i * 0x37) & 0xff]).flat();
    // prettier-ignore
    const writes = [
      0x26, 0x80, 0x24, 0x77, 0x25, 0xff, 0x10, 0x15, 0x11, 0x80, 0x12, 0xf3, 0x13, 0x00,
      0x14, 0x87, 0x16, 0x40, 0x17, 0xa5, 0x18, 0x80, 0x19, 0x86, ...waveform, 0x1a, 0x80,
      0x1c, 0x20, 0x1d, 0x40, 0x1e, 0x87, 0x21, 0xf1, 0x22, 0x37, 0x23, 0x80,
    ];
    const program: number[] = [];
    for (let i = 0; i < writes.length; i += 2) program.push(0x3e, writes[i + 1]!, 0xe0, writes[i]!);
    const rom = makeRom([...program, 0x18, 0xfe]);
    const a = new GameBoy(rom);
    for (let i = 0; i < 7; i++) a.runFrame();
    for (let i = 0; i < 1234; i++) a.step();
    const b = new GameBoy(rom);
    b.deserialize(a.serialize(T0), T0);
    // Channel phase (duty step, LFSR, wave position) is only audible, so compare the sound.
    a.apu.setSampleRate(48_000);
    b.apu.setSampleRate(48_000);
    for (let i = 0; i < 20; i++) {
      a.runFrame();
      b.runFrame();
      expect(b.apu.takeSamples()).toEqual(a.apu.takeSamples());
    }
    expect(b.serialize(T0)).toEqual(a.serialize(T0));
  });

  const cpuInstrs = romPath('blargg/cpu_instrs/individual/02-interrupts.gb');
  it.skipIf(!cpuInstrs)('resumes a test ROM mid-run and still passes', () => {
    const rom = loadRom(cpuInstrs!);
    const a = new GameBoy(rom);
    for (let i = 0; i < 20; i++) a.runFrame();
    const b = new GameBoy(rom);
    b.deserialize(a.serialize());
    let output = '';
    b.serial.onByte = (byte) => (output += String.fromCharCode(byte));
    for (let i = 0; i < 600 && !/Passed|Failed/.test(output); i++) b.runFrame();
    expect(output).toContain('Passed');
  });

  it('recolors the restored frame in the current palette', () => {
    const a = new GameBoy(busy);
    for (let i = 0; i < 5; i++) a.runFrame();
    const b = new GameBoy(busy, { palette: [0xffffff, 0xaaaaaa, 0x555555, 0x000000] });
    b.deserialize(a.serialize());
    // Classic palette shade 0 is 0x9bbc0f; mono shade 0 is white.
    expect([...a.framebuffer.subarray(0, 3)]).toEqual([0x9b, 0xbc, 0x0f]);
    expect([...b.framebuffer.subarray(0, 3)]).toEqual([0xff, 0xff, 0xff]);
  });

  it('rejects states for another game, version or damaged data, leaving the machine as is', () => {
    const a = new GameBoy(busy);
    for (let i = 0; i < 3; i++) a.runFrame();
    const state = a.serialize(T0);

    const other = new GameBoy(makeRom([0x18, 0xfe], { title: 'OTHER' }));
    expect(() => other.deserialize(state)).toThrow(/different game/);

    const b = new GameBoy(busy);
    const before = b.serialize(T0);
    const newer = state.slice();
    newer[4] = 99;
    expect(() => b.deserialize(newer)).toThrow(/incompatible version/);
    expect(() => b.deserialize(state.subarray(0, state.length - 100), T0)).toThrow(SaveStateError);
    expect(() => b.deserialize(new Uint8Array(10))).toThrow(/not a ReactBoy save state/);
    expect(b.serialize(T0)).toEqual(before);
  });
});

describe('battery saves', () => {
  const battery = makeRom(ramWriter(0x42), { type: 0x03, ramSizeCode: 0x02 }); // MBC1+RAM+BATTERY

  it('tracks writes to battery RAM and round-trips them', () => {
    const a = new GameBoy(battery);
    expect(a.batteryDirty).toBe(false);
    a.runFrame();
    expect(a.batteryDirty).toBe(true);
    const save = a.exportBattery()!;
    expect(save.length).toBe(0x2000);
    expect(save[0]).toBe(0x42);
    a.batteryDirty = false;

    const b = new GameBoy(makeRom([0x18, 0xfe], { type: 0x03, ramSizeCode: 0x02 }));
    b.importBattery(save);
    expect(b.mbc.ram[0]).toBe(0x42);
  });

  it('marks battery RAM for saving after a state is loaded', () => {
    const a = new GameBoy(battery);
    a.runFrame();
    const state = a.serialize();
    a.batteryDirty = false;
    a.deserialize(state);
    expect(a.batteryDirty).toBe(true);
  });

  it('has nothing to save without a battery', () => {
    const gb = new GameBoy(makeRom(ramWriter(1), { type: 0x02, ramSizeCode: 0x02 })); // no battery
    gb.runFrame();
    expect(gb.batteryDirty).toBe(false);
    expect(gb.exportBattery()).toBeNull();
  });

  /** Sets the MBC3 clock's minutes register to 30, then spins. */
  const clock = makeRom(
    [
      ...[0x3e, 0x0a, 0xea, 0x00, 0x00], // enable RAM/RTC
      ...[0x3e, 0x09, 0xea, 0x00, 0x40], // select RTC minutes
      ...[0x3e, 30, 0xea, 0x00, 0xa0], // minutes = 30
      ...[0x18, 0xfe],
    ],
    { type: 0x10, ramSizeCode: 0x02 }, // MBC3+TIMER+RAM+BATTERY
  );

  /** Latches the clock and reads S, M, H. */
  const readClock = (gb: GameBoy) => {
    const { mbc } = gb;
    mbc.writeRom(0x0000, 0x0a);
    mbc.writeRom(0x6000, 0);
    mbc.writeRom(0x6000, 1);
    return [0x08, 0x09, 0x0a].map((reg) => {
      mbc.writeRom(0x4000, reg);
      return mbc.readRam(0xa000);
    });
  };

  it('stores the MBC3 clock in a 48-byte footer and catches up on real time', () => {
    const a = new GameBoy(clock);
    a.runFrame();
    const save = a.exportBattery(T0)!;
    expect(save.length).toBe(0x2000 + 48);

    const b = new GameBoy(clock);
    b.importBattery(save, T0 + 3_661_000); // 1 h 1 min 1 s later
    expect(readClock(b)).toEqual([1, 31, 1]);
  });

  it('accepts the 44-byte footer older emulators write', () => {
    const a = new GameBoy(clock);
    a.runFrame();
    const save = a.exportBattery(T0)!.subarray(0, 0x2000 + 44);
    const b = new GameBoy(clock);
    b.importBattery(save, T0 + 5_000);
    expect(readClock(b)).toEqual([5, 30, 0]);
  });

  it('advances the clock by the real time since a save state was made', () => {
    const a = new GameBoy(clock);
    a.runFrame();
    const state = a.serialize(T0);
    const b = new GameBoy(clock);
    b.deserialize(state, T0 + 120_000);
    expect(readClock(b)).toEqual([0, 32, 0]);
  });
});
