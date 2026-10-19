import { Apu } from './apu/apu';
import { createCartridge, type CartridgeHeader, type Mbc } from './cartridge';
import { CYCLES_PER_FRAME } from './constants';
import { Cpu, type Bus } from './cpu/cpu';
import { OamDma } from './dma';
import { Interrupts } from './interrupts';
import { Joypad, type ButtonId } from './joypad';
import { Mmu } from './memory/mmu';
import type { Palette } from './ppu/palette';
import { Ppu } from './ppu/ppu';
import { Serial } from './serial';
import { Timer } from './timer';

export interface GameBoyOptions {
  palette?: Palette;
}

/**
 * A complete DMG. The CPU drives the clock: every M-cycle it spends, {@link tick} advances
 * the timer, PPU, DMA and serial port by the same amount.
 */
export class GameBoy implements Bus {
  readonly header: CartridgeHeader;
  readonly cpu: Cpu;
  readonly mmu: Mmu;
  readonly ppu: Ppu;
  readonly apu: Apu;
  readonly timer: Timer;
  readonly joypad: Joypad;
  readonly serial: Serial;
  readonly interrupts: Interrupts;
  readonly dma: OamDma;
  readonly mbc: Mbc;
  /** Total T-cycles since power-on. */
  cycles = 0;

  constructor(rom: Uint8Array, options: GameBoyOptions = {}) {
    const cartridge = createCartridge(rom, () => this.cycles);
    this.header = cartridge.header;
    this.mbc = cartridge.mbc;
    this.interrupts = new Interrupts();
    this.ppu = new Ppu(this.interrupts);
    if (options.palette) this.ppu.setPalette(options.palette);
    this.apu = new Apu();
    this.timer = new Timer(this.interrupts);
    this.joypad = new Joypad(this.interrupts);
    this.serial = new Serial(this.interrupts);
    this.mmu = new Mmu({
      mbc: this.mbc,
      ppu: this.ppu,
      apu: this.apu,
      timer: this.timer,
      joypad: this.joypad,
      serial: this.serial,
      interrupts: this.interrupts,
    });
    this.dma = new OamDma((addr) => this.mmu.read(addr), this.ppu.oam);
    this.mmu.attachDma(this.dma);
    this.cpu = new Cpu(this, this.interrupts);
    this.cpu.reset(this.header.headerChecksum);
  }

  /** The most recently completed frame as 160x144 RGBA. */
  get framebuffer(): Uint8ClampedArray {
    return this.ppu.framebuffer;
  }

  /**
   * Runs until the PPU finishes a frame (or one frame's worth of cycles passes while the
   * LCD is off).
   */
  runFrame(): void {
    const frame = this.ppu.frameCount;
    const start = this.cycles;
    while (this.ppu.frameCount === frame && this.cycles - start < CYCLES_PER_FRAME) {
      this.cpu.step();
    }
  }

  /** Runs one CPU instruction; returns the T-cycles it took. */
  step(): number {
    const start = this.cycles;
    this.cpu.step();
    return this.cycles - start;
  }

  setButton(button: ButtonId, pressed: boolean): void {
    this.joypad.setButton(button, pressed);
  }

  setPalette(palette: Palette): void {
    this.ppu.setPalette(palette);
  }

  // --- Bus ------------------------------------------------------------------------------

  read(addr: number): number {
    return this.mmu.read(addr);
  }

  write(addr: number, value: number): void {
    this.mmu.write(addr, value);
  }

  tick(): void {
    this.cycles += 4;
    this.timer.tick();
    this.ppu.tick();
    this.dma.tick();
    this.serial.tick();
  }

  stop(): void {
    this.timer.writeDiv();
  }
}
