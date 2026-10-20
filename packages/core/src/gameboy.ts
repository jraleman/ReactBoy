import type { BusActivity } from './activity';
import { Apu } from './apu/apu';
import { createCartridge, type CartridgeHeader, type Mbc } from './cartridge';
import { RTC_FOOTER_SIZE } from './cartridge/rtc';
import { CYCLES_PER_FRAME } from './constants';
import { Cpu, type Bus } from './cpu/cpu';
import { OamDma } from './dma';
import { Interrupts } from './interrupts';
import { Joypad, type ButtonId } from './joypad';
import { Mmu } from './memory/mmu';
import type { Palette } from './ppu/palette';
import { Ppu } from './ppu/ppu';
import { Serial } from './serial';
import { SaveStateError, StateReader, StateWriter, type Stateful } from './state';
import { Timer } from './timer';

/** "RBST", little-endian. */
const STATE_MAGIC = 0x54534252;
/** Bump whenever any component's saved layout changes; older states are then rejected. */
export const STATE_VERSION = 2;

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
  /** Called after every CPU write while set; the debugger's watchpoints use it. */
  onWrite: ((addr: number, value: number) => void) | null = null;
  /** Called after every CPU read (instruction fetches included) while set. */
  onRead: ((addr: number, value: number) => void) | null = null;
  /** CPU reads and writes by 8 KiB region of the address space, for {@link takeActivity}. */
  private readonly reads = new Float64Array(8);
  private readonly writes = new Float64Array(8);
  private idleCycles = 0;
  /** {@link cycles} when activity was last taken. */
  private activitySince = 0;
  /** Everything a save state covers, in the order it is written. */
  private readonly parts: readonly Stateful[];
  /** Global checksum (0x14E-0x14F), used to tell games apart in save states. */
  private readonly romChecksum: number;

  constructor(rom: Uint8Array, options: GameBoyOptions = {}) {
    const cartridge = createCartridge(rom, () => this.cycles);
    this.header = cartridge.header;
    this.mbc = cartridge.mbc;
    this.interrupts = new Interrupts();
    this.ppu = new Ppu(this.interrupts);
    if (options.palette) this.ppu.setPalette(options.palette);
    this.apu = new Apu();
    this.timer = new Timer(this.interrupts, () => this.apu.clockFrameSequencer());
    this.joypad = new Joypad(this.interrupts);
    this.serial = new Serial(this.interrupts, () => this.timer.counter);
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
    this.romChecksum = ((rom[0x14e] ?? 0) << 8) | (rom[0x14f] ?? 0);
    this.parts = [
      this.cpu,
      this.interrupts,
      this.timer,
      this.joypad,
      this.serial,
      this.dma,
      this.mmu,
      this.ppu,
      this.apu,
      this.mbc,
    ];
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

  /** Reads memory without side effects, for debuggers (see {@link Mmu.peek}). */
  peek(addr: number): number {
    return this.mmu.peek(addr);
  }

  /** Writes memory for a debugger (see {@link Mmu.poke}); watchpoints don't see it. */
  poke(addr: number, value: number): void {
    this.mmu.poke(addr, value);
  }

  /** What the machine did since the last call (or power-on), and starts counting afresh. */
  takeActivity(): BusActivity {
    const { reads: r, writes: w } = this;
    const activity: BusActivity = {
      cycles: Math.max(0, this.cycles - this.activitySince),
      idleCycles: this.idleCycles,
      romReads: r[0]! + r[1]! + r[2]! + r[3]!,
      mbcWrites: w[0]! + w[1]! + w[2]! + w[3]!,
      vramReads: r[4]!,
      vramWrites: w[4]!,
      cartRamReads: r[5]!,
      cartRamWrites: w[5]!,
      wramReads: r[6]!,
      wramWrites: w[6]!,
      dmaTransfers: this.dma.starts,
      serialTransfers: this.serial.transfers,
      lcdc: this.ppu.lcdc,
      nr52: this.apu.peek(0xff26),
      sc: this.serial.readControl(),
    };
    r.fill(0);
    w.fill(0);
    this.idleCycles = 0;
    this.dma.starts = 0;
    this.serial.transfers = 0;
    this.activitySince = this.cycles;
    return activity;
  }

  setButton(button: ButtonId, pressed: boolean): void {
    this.joypad.setButton(button, pressed);
  }

  setPalette(palette: Palette): void {
    this.ppu.setPalette(palette);
  }

  // --- Saves ----------------------------------------------------------------------------

  /** Battery RAM changed since it was last saved (always false without a battery). */
  get batteryDirty(): boolean {
    return this.header.hasBattery && this.mmu.cartRamDirty;
  }
  set batteryDirty(dirty: boolean) {
    this.mmu.cartRamDirty = dirty;
  }

  /**
   * Battery-backed RAM in the usual .sav layout: RAM, then for MBC3+TIMER the 48-byte clock
   * block other emulators use. Null if the cartridge has no battery.
   * @param wallMs current wall-clock time, stored so the clock can catch up on next load
   */
  exportBattery(wallMs = Date.now()): Uint8Array | null {
    if (!this.header.hasBattery) return null;
    const { ram, rtc } = this.mbc;
    const save = new Uint8Array(ram.length + (rtc ? RTC_FOOTER_SIZE : 0));
    save.set(ram);
    rtc?.writeFooter(new DataView(save.buffer), ram.length, wallMs);
    return save;
  }

  /** Loads a .sav file. Extra or missing bytes are tolerated, as in other emulators. */
  importBattery(save: Uint8Array, wallMs = Date.now()): void {
    const { ram, rtc } = this.mbc;
    ram.set(save.subarray(0, ram.length));
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
    if (save.length > ram.length) rtc?.readFooter(view, ram.length, wallMs);
  }

  /** The whole machine as a versioned save state. ROM bytes are not included. */
  serialize(wallMs = Date.now()): Uint8Array {
    const w = new StateWriter();
    w.u32(STATE_MAGIC);
    w.u16(STATE_VERSION);
    w.u16(this.romChecksum);
    w.u8(this.header.headerChecksum);
    w.f64(wallMs);
    w.f64(this.cycles);
    for (const part of this.parts) part.writeState(w);
    return w.finish();
  }

  /**
   * Restores a state from {@link serialize}. On failure the machine is left as it was.
   * @throws SaveStateError if the data is damaged, from another game or another version
   */
  deserialize(data: Uint8Array, wallMs = Date.now()): void {
    const r = new StateReader(data);
    if (data.length < 4 || r.u32() !== STATE_MAGIC) {
      throw new SaveStateError('This is not a ReactBoy save state.');
    }
    if (r.u16() !== STATE_VERSION) {
      throw new SaveStateError('This save state is from an incompatible version of ReactBoy.');
    }
    if (r.u16() !== this.romChecksum || r.u8() !== this.header.headerChecksum) {
      throw new SaveStateError('This save state belongs to a different game.');
    }
    const savedAt = r.f64();
    const backup = this.serialize(wallMs);
    try {
      this.cycles = r.f64();
      for (const part of this.parts) part.readState(r);
      if (!r.done) throw new SaveStateError('This save state has unexpected trailing data.');
    } catch (error) {
      this.deserialize(backup, wallMs);
      throw error instanceof SaveStateError
        ? error
        : new SaveStateError('This save state is damaged.');
    }
    this.mbc.rtc?.catchUp((wallMs - savedAt) / 1000);
    this.activitySince = this.cycles;
    // Cartridge RAM rolled back with the state; save it so the battery file agrees.
    this.batteryDirty = true;
  }

  // --- Bus ------------------------------------------------------------------------------

  read(addr: number): number {
    const value = this.mmu.read(addr);
    this.reads[addr >>> 13]!++;
    if (this.onRead !== null) this.onRead(addr, value);
    return value;
  }

  write(addr: number, value: number): void {
    this.mmu.write(addr, value);
    this.writes[addr >>> 13]!++;
    if (this.onWrite !== null) this.onWrite(addr, value);
  }

  tick(): void {
    this.cycles += 4;
    const { cpu } = this;
    if (cpu.halted || cpu.stopped || cpu.locked) this.idleCycles += 4;
    this.timer.tick();
    this.apu.tick();
    this.ppu.tick();
    this.dma.tick();
    this.serial.tick();
  }

  stop(): void {
    this.timer.writeDiv();
  }
}
