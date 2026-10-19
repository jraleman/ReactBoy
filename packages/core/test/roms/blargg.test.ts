import { describe, expect, it } from 'vitest';
import { loadRom, romPath, runMemoryRom, runSerialRom } from '../helpers/roms';

const SUITES: Record<string, { roms: string[]; maxFrames: number }> = {
  cpu_instrs: {
    roms: [
      '01-special',
      '02-interrupts',
      '03-op sp,hl',
      '04-op r,imm',
      '05-op rp',
      '06-ld r,r',
      '07-jr,jp,call,ret,rst',
      '08-misc instrs',
      '09-op r,r',
      '10-bit ops',
      '11-op a,(hl)',
    ].map((name) => `blargg/cpu_instrs/individual/${name}.gb`),
    maxFrames: 60 * 60,
  },
  instr_timing: { roms: ['blargg/instr_timing/instr_timing.gb'], maxFrames: 60 * 10 },
  mem_timing: {
    roms: ['01-read_timing', '02-write_timing', '03-modify_timing'].map(
      (name) => `blargg/mem_timing/individual/${name}.gb`,
    ),
    maxFrames: 60 * 10,
  },
};

for (const [suite, { roms, maxFrames }] of Object.entries(SUITES)) {
  describe(`blargg ${suite}`, () => {
    for (const rom of roms) {
      const path = romPath(rom);
      it.skipIf(!path)(rom.split('/').pop()!, () => {
        const output = runSerialRom(loadRom(path!), maxFrames);
        expect(output).toContain('Passed');
      });
    }
  });
}

// dmg_sound reports in cartridge RAM instead of over serial.
const DMG_SOUND = [
  '01-registers',
  '02-len ctr',
  '03-trigger',
  '04-sweep',
  '05-sweep details',
  '06-overflow on trigger',
  '07-len sweep period sync',
  '08-len ctr during power',
  '09-wave read while on',
  '10-wave trigger while on',
  '11-regs after power',
  '12-wave write while on',
].map((name) => `blargg/dmg_sound/rom_singles/${name}.gb`);

describe('blargg dmg_sound', () => {
  for (const rom of DMG_SOUND) {
    const path = romPath(rom);
    it.skipIf(!path)(rom.split('/').pop()!, () => {
      const { status, text } = runMemoryRom(loadRom(path!), 60 * 30);
      expect(text).toContain('Passed');
      expect(status).toBe(0);
    });
  }
});
