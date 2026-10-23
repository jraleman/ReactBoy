/** Hardware register addresses (Pan Docs names). */
export const IO = {
  P1: 0xff00,
  SB: 0xff01,
  SC: 0xff02,
  DIV: 0xff04,
  TIMA: 0xff05,
  TMA: 0xff06,
  TAC: 0xff07,
  IF: 0xff0f,
  LCDC: 0xff40,
  STAT: 0xff41,
  SCY: 0xff42,
  SCX: 0xff43,
  LY: 0xff44,
  LYC: 0xff45,
  DMA: 0xff46,
  BGP: 0xff47,
  OBP0: 0xff48,
  OBP1: 0xff49,
  WY: 0xff4a,
  WX: 0xff4b,
  /** Game Boy Color: the VRAM bank the CPU sees at 0x8000-0x9FFF. */
  VBK: 0xff4f,
  BOOT: 0xff50,
  /** Game Boy Color: VRAM DMA source (high, low), destination (high, low) and control. */
  HDMA1: 0xff51,
  HDMA2: 0xff52,
  HDMA3: 0xff53,
  HDMA4: 0xff54,
  HDMA5: 0xff55,
  /** Game Boy Color: background palette RAM index (BGPI in some docs). */
  BCPS: 0xff68,
  /** Game Boy Color: background palette RAM data at the BCPS index. */
  BCPD: 0xff69,
  /** Game Boy Color: sprite palette RAM index. */
  OCPS: 0xff6a,
  /** Game Boy Color: sprite palette RAM data at the OCPS index. */
  OCPD: 0xff6b,
  /** Game Boy Color: sprite priority by OAM index (0) or X position (1), set by the boot ROM. */
  OPRI: 0xff6c,
  /** Game Boy Color: the WRAM bank at 0xD000-0xDFFF. */
  SVBK: 0xff70,
  IE: 0xffff,
} as const;
