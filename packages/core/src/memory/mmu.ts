import type { Apu } from '../apu/apu';
import type { Mbc } from '../cartridge';
import type { OamDma } from '../dma';
import type { Hdma } from '../hdma';
import type { Interrupts } from '../interrupts';
import type { Joypad } from '../joypad';
import type { Ppu } from '../ppu/ppu';
import type { Serial } from '../serial';
import type { Speed } from '../speed';
import type { StateReader, StateWriter, Stateful } from '../state';
import type { Timer } from '../timer';
import { IO } from './memory-map';

export interface MmuDevices {
  mbc: Mbc;
  ppu: Ppu;
  apu: Apu;
  timer: Timer;
  joypad: Joypad;
  serial: Serial;
  interrupts: Interrupts;
  speed: Speed;
  dma: OamDma;
}

/**
 * Routes the 16-bit address space to cartridge, RAM and hardware registers. On a Game Boy
 * Color, VBK and SVBK choose the VRAM bank at 0x8000 and the WRAM bank at 0xD000.
 */
export class Mmu implements Stateful {
  /** 8 x 4 KiB banks; a DMG only has banks 0 and 1. */
  readonly wram = new Uint8Array(0x8000);
  readonly hram = new Uint8Array(0x7f);
  /** Set by any write to cartridge RAM; cleared once battery RAM has been saved. */
  cartRamDirty = false;
  /** WRAM bank at 0xD000-0xDFFF, 1-7. */
  private wramBank = 1;
  /** VRAM bank at 0x8000-0x9FFF, 0-1. */
  private vramBank = 0;
  /**
   * 0xFF72-0xFF75 on a Game Boy Color: registers with no known function that still hold
   * what is written (only bits 4-6 of 0xFF75).
   */
  private readonly spare = new Uint8Array(4);
  private dma!: OamDma;
  private hdma!: Hdma;

  constructor(
    private readonly devices: Omit<MmuDevices, 'dma'>,
    private readonly cgb = false,
  ) {}

  /** The DMA units read through the MMU, so they are attached after construction. */
  attachDma(dma: OamDma, hdma: Hdma): void {
    this.dma = dma;
    this.hdma = hdma;
  }

  read(addr: number): number {
    const d = this.devices;
    if (addr < 0x8000) return d.mbc.readRom(addr);
    if (addr < 0xa000) return d.ppu.vramReadable() ? d.ppu.vram[this.vramOffset(addr)]! : 0xff;
    if (addr < 0xc000) return d.mbc.readRam(addr);
    if (addr < 0xfe00) return this.wram[this.wramOffset(addr)]!;
    if (addr < 0xfea0) {
      return d.ppu.oamReadable() && !this.dma.active ? d.ppu.oam[addr - 0xfe00]! : 0xff;
    }
    if (addr < 0xff00) return 0xff;
    if (addr >= 0xff80 && addr < 0xffff) return this.hram[addr - 0xff80]!;
    return this.readIo(addr);
  }

  /**
   * What `addr` holds, for debuggers: VRAM and OAM even while the PPU or DMA blocks them,
   * and no side effects on the sound hardware.
   */
  peek(addr: number): number {
    const d = this.devices;
    if (addr >= 0x8000 && addr < 0xa000) return d.ppu.vram[this.vramOffset(addr)]!;
    if (addr >= 0xfe00 && addr < 0xfea0) return d.ppu.oam[addr - 0xfe00]!;
    if (addr >= 0xff10 && addr < 0xff40) return d.apu.peek(addr);
    return this.read(addr);
  }

  /**
   * Writes `addr` for debuggers: VRAM and OAM even while the PPU or DMA blocks them. ROM and
   * the unusable area are left alone (a write there would switch banks, not change bytes);
   * everything else is written as the CPU would, so I/O registers have their usual effects.
   */
  poke(addr: number, value: number): void {
    const d = this.devices;
    if (addr < 0x8000 || (addr >= 0xfea0 && addr < 0xff00)) return;
    if (addr < 0xa000) d.ppu.vram[this.vramOffset(addr)] = value;
    else if (addr >= 0xfe00 && addr < 0xfea0) d.ppu.oam[addr - 0xfe00] = value;
    else this.write(addr, value);
  }

  write(addr: number, value: number): void {
    const d = this.devices;
    if (addr < 0x8000) d.mbc.writeRom(addr, value);
    else if (addr < 0xa000) {
      if (d.ppu.vramWritable()) d.ppu.vram[this.vramOffset(addr)] = value;
    } else if (addr < 0xc000) {
      d.mbc.writeRam(addr, value);
      this.cartRamDirty = true;
    } else if (addr < 0xfe00) this.wram[this.wramOffset(addr)] = value;
    else if (addr < 0xfea0) {
      if (d.ppu.oamWritable() && !this.dma.active) d.ppu.oam[addr - 0xfe00] = value;
    } else if (addr < 0xff00) {
      // Unusable region: writes are ignored.
    } else if (addr >= 0xff80 && addr < 0xffff) this.hram[addr - 0xff80] = value;
    else this.writeIo(addr, value);
  }

  writeState(w: StateWriter): void {
    w.bytes(this.wram);
    w.bytes(this.hram);
    w.u8(this.wramBank);
    w.u8(this.vramBank);
    w.bytes(this.spare);
  }

  readState(r: StateReader): void {
    r.bytes(this.wram);
    r.bytes(this.hram);
    this.wramBank = r.u8() & 7 || 1;
    // Version 2 states predate the Game Boy Color's registers.
    if (r.version < 3) {
      this.vramBank = 0;
      this.spare.fill(0);
    } else {
      this.vramBank = r.u8() & 1;
      r.bytes(this.spare);
    }
  }

  private vramOffset(addr: number): number {
    return this.vramBank * 0x2000 + (addr - 0x8000);
  }

  /** Echo RAM (0xE000-0xFDFF) mirrors 0xC000-0xDDFF. */
  private wramOffset(addr: number): number {
    const a = addr >= 0xe000 ? addr - 0x2000 : addr;
    return a < 0xd000 ? a - 0xc000 : this.wramBank * 0x1000 + (a - 0xd000);
  }

  private readIo(addr: number): number {
    const { ppu, timer, joypad, serial, interrupts, apu } = this.devices;
    switch (addr) {
      case IO.P1:
        return joypad.read();
      case IO.SB:
        return serial.data;
      case IO.SC:
        return serial.readControl();
      case IO.DIV:
        return timer.readDiv();
      case IO.TIMA:
        return timer.tima;
      case IO.TMA:
        return timer.tma;
      case IO.TAC:
        return timer.readTac();
      case IO.IF:
        return interrupts.readFlags();
      case IO.LCDC:
        return ppu.lcdc;
      case IO.STAT:
        return ppu.readStat();
      case IO.SCY:
        return ppu.scy;
      case IO.SCX:
        return ppu.scx;
      case IO.LY:
        return ppu.ly;
      case IO.LYC:
        return ppu.lyc;
      case IO.DMA:
        return this.dma.register;
      case IO.BGP:
        return ppu.bgp;
      case IO.OBP0:
        return ppu.obp0;
      case IO.OBP1:
        return ppu.obp1;
      case IO.WY:
        return ppu.wy;
      case IO.WX:
        return ppu.wx;
      case IO.IE:
        return interrupts.enable;
    }
    if (addr >= 0xff10 && addr < 0xff40) return apu.read(addr);
    if (!this.cgb) return 0xff;
    switch (addr) {
      case IO.KEY1:
        return this.devices.speed.read();
      case IO.HDMA5:
        return this.hdma.readControl();
      case IO.VBK:
        return 0xfe | this.vramBank;
      case IO.BCPS:
      case IO.OCPS:
        return ppu.readPaletteIndex(addr === IO.OCPS);
      case IO.BCPD:
      case IO.OCPD:
        return ppu.readPaletteData(addr === IO.OCPD);
      case IO.OPRI:
        // Priority by OAM index, as the boot ROM sets it for color games; locked since.
        return 0xfe;
      case IO.SVBK:
        return 0xf8 | this.wramBank;
      case 0xff75:
        return 0x8f | this.spare[3]!;
    }
    if (addr >= 0xff72 && addr < 0xff75) return this.spare[addr - 0xff72]!;
    return 0xff;
  }

  private writeIo(addr: number, value: number): void {
    const { ppu, timer, joypad, serial, interrupts, apu } = this.devices;
    switch (addr) {
      case IO.P1:
        return joypad.write(value);
      case IO.SB:
        serial.data = value;
        return;
      case IO.SC:
        return serial.writeControl(value);
      case IO.DIV:
        return timer.writeDiv();
      case IO.TIMA:
        return timer.writeTima(value);
      case IO.TMA:
        return timer.writeTma(value);
      case IO.TAC:
        return timer.writeTac(value);
      case IO.IF:
        return interrupts.writeFlags(value);
      case IO.LCDC:
        return ppu.writeLcdc(value);
      case IO.STAT:
        return ppu.writeStat(value);
      case IO.SCY:
        ppu.scy = value;
        return;
      case IO.SCX:
        ppu.scx = value;
        return;
      case IO.LY:
        return; // read-only
      case IO.LYC:
        return ppu.writeLyc(value);
      case IO.DMA:
        return this.dma.start(value);
      case IO.BGP:
        ppu.bgp = value;
        return;
      case IO.OBP0:
        ppu.obp0 = value;
        return;
      case IO.OBP1:
        ppu.obp1 = value;
        return;
      case IO.WY:
        ppu.wy = value;
        return;
      case IO.WX:
        ppu.wx = value;
        return;
      case IO.IE:
        interrupts.enable = value;
        return;
    }
    if (addr >= 0xff10 && addr < 0xff40) apu.write(addr, value);
    if (!this.cgb) return;
    if (addr === IO.KEY1) this.devices.speed.write(value);
    else if (addr === IO.VBK) this.vramBank = value & 1;
    else if (addr >= IO.HDMA1 && addr < IO.HDMA5) this.hdma.writeAddress(addr - IO.HDMA1, value);
    else if (addr === IO.HDMA5) this.hdma.writeControl(value);
    else if (addr === IO.BCPS || addr === IO.OCPS) ppu.writePaletteIndex(addr === IO.OCPS, value);
    else if (addr === IO.BCPD || addr === IO.OCPD) ppu.writePaletteData(addr === IO.OCPD, value);
    // Bank 0 is always at 0xC000; asking for it at 0xD000 gives bank 1.
    else if (addr === IO.SVBK) this.wramBank = value & 7 || 1;
    else if (addr === 0xff75) this.spare[3] = value & 0x70;
    else if (addr >= 0xff72 && addr < 0xff75) this.spare[addr - 0xff72] = value;
  }
}
