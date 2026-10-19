import type { Apu } from '../apu/apu';
import type { Mbc } from '../cartridge';
import type { OamDma } from '../dma';
import type { Interrupts } from '../interrupts';
import type { Joypad } from '../joypad';
import type { Ppu } from '../ppu/ppu';
import type { Serial } from '../serial';
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
  dma: OamDma;
}

/** Routes the 16-bit address space to cartridge, RAM and hardware registers. */
export class Mmu {
  /** 8 x 4 KiB banks so CGB banking can slot in; a DMG only uses banks 0 and 1. */
  readonly wram = new Uint8Array(0x8000);
  readonly hram = new Uint8Array(0x7f);
  private wramBank = 1;
  private dma!: OamDma;

  constructor(private readonly devices: Omit<MmuDevices, 'dma'>) {}

  /** The DMA unit reads through the MMU, so it is attached after construction. */
  attachDma(dma: OamDma): void {
    this.dma = dma;
  }

  read(addr: number): number {
    const d = this.devices;
    if (addr < 0x8000) return d.mbc.readRom(addr);
    if (addr < 0xa000) return d.ppu.vramAccessible() ? d.ppu.vram[addr - 0x8000]! : 0xff;
    if (addr < 0xc000) return d.mbc.readRam(addr);
    if (addr < 0xfe00) return this.wram[this.wramOffset(addr)]!;
    if (addr < 0xfea0) {
      return d.ppu.oamAccessible() && !this.dma.active ? d.ppu.oam[addr - 0xfe00]! : 0xff;
    }
    if (addr < 0xff00) return 0xff;
    if (addr >= 0xff80 && addr < 0xffff) return this.hram[addr - 0xff80]!;
    return this.readIo(addr);
  }

  write(addr: number, value: number): void {
    const d = this.devices;
    if (addr < 0x8000) d.mbc.writeRom(addr, value);
    else if (addr < 0xa000) {
      if (d.ppu.vramAccessible()) d.ppu.vram[addr - 0x8000] = value;
    } else if (addr < 0xc000) d.mbc.writeRam(addr, value);
    else if (addr < 0xfe00) this.wram[this.wramOffset(addr)] = value;
    else if (addr < 0xfea0) {
      if (d.ppu.oamAccessible() && !this.dma.active) d.ppu.oam[addr - 0xfe00] = value;
    } else if (addr < 0xff00) {
      // Unusable region: writes are ignored.
    } else if (addr >= 0xff80 && addr < 0xffff) this.hram[addr - 0xff80] = value;
    else this.writeIo(addr, value);
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
  }
}
