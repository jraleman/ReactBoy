/**
 * What the machine did over a stretch of time, cheap enough to count on every bus access.
 * Visualisations use it to show which parts are busy; nothing in the emulation reads it.
 */
export interface BusActivity {
  /** T-cycles covered. */
  cycles: number;
  /** Of those, cycles the CPU spent halted, stopped or locked up rather than executing. */
  idleCycles: number;
  /** CPU reads of cartridge ROM, instruction fetches included. */
  romReads: number;
  /** CPU writes to the ROM area: commands to the cartridge's MBC, such as bank switches. */
  mbcWrites: number;
  vramReads: number;
  vramWrites: number;
  cartRamReads: number;
  cartRamWrites: number;
  wramReads: number;
  wramWrites: number;
  /** OAM DMA copies started (usually one a frame, from work RAM). */
  dmaTransfers: number;
  /** Link-port transfers started. */
  serialTransfers: number;
  /** LCDC, NR52 and SC as they are at the end. */
  lcdc: number;
  nr52: number;
  sc: number;
}
