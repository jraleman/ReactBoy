import { hex2, hex4, parseAddress } from './hex';

/** An address, limited to one ROM bank when `bank` is set (0x4000-0x7FFF only). */
export interface Location {
  addr: number;
  bank: number | null;
}

/** Labels from an RGBDS .sym file ("BB:AAAA Name" per line, ";" comments). */
export interface SymbolTable {
  readonly count: number;
  /** The label at `addr`, taking `romBank` as mapped at 0x4000-0x7FFF. */
  labelAt(addr: number, romBank: number): string | null;
  /** Where a label is; exact match first, then ignoring case. */
  find(name: string): Location | null;
}

/** The switchable ROM area, where a bank number tells same-address labels apart. */
export const isBanked = (addr: number) => addr >= 0x4000 && addr < 0x8000;

const LINE = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})\s+(\S+)/i;

/** Local labels ("Main.loop") give way to the routine's own name at the same address. */
const better = (current: string | undefined, name: string) =>
  current === undefined || (current.includes('.') && !name.includes('.'));

export function parseSymbols(text: string): SymbolTable {
  /** Key: address, plus the bank for banked addresses. */
  const labels = new Map<string, string>();
  const names = new Map<string, Location>();
  const lowerNames = new Map<string, Location>();
  const key = (addr: number, bank: number) => (isBanked(addr) ? `${bank}:${addr}` : `${addr}`);

  for (const raw of text.split(/\r?\n/)) {
    const match = LINE.exec(raw.replace(/;.*/, '').trim());
    if (!match) continue;
    const bank = parseInt(match[1]!, 16);
    const addr = parseInt(match[2]!, 16);
    const name = match[3]!;
    const k = key(addr, bank);
    if (better(labels.get(k), name)) labels.set(k, name);
    const location = { addr, bank: isBanked(addr) ? bank : null };
    if (!names.has(name)) names.set(name, location);
    if (!lowerNames.has(name.toLowerCase())) lowerNames.set(name.toLowerCase(), location);
  }

  return {
    count: names.size,
    labelAt: (addr, romBank) => labels.get(key(addr, romBank)) ?? null,
    find: (name) => names.get(name) ?? lowerNames.get(name.toLowerCase()) ?? null,
  };
}

/**
 * Reads a location typed by the player: a hex address ("C000", "$C000", "0xC000"), a banked
 * one ("03:4567") or a label from the symbol file.
 */
export function parseLocation(text: string, symbols: SymbolTable | null): Location | null {
  const trimmed = text.trim();
  const banked = /^\$?([0-9a-f]{1,2}):\$?([0-9a-f]{1,4})$/i.exec(trimmed);
  if (banked) {
    const addr = parseInt(banked[2]!, 16);
    return { addr, bank: isBanked(addr) ? parseInt(banked[1]!, 16) : null };
  }
  const addr = parseAddress(trimmed);
  if (addr !== null) return { addr, bank: null };
  return symbols?.find(trimmed) ?? null;
}

/** "03:4567" for a banked location, "$C000" otherwise. */
export const formatLocation = ({ addr, bank }: Location) =>
  bank === null ? `$${hex4(addr)}` : `${hex2(bank)}:${hex4(addr)}`;

/** Whether a breakpoint at `location` applies while `romBank` is mapped. */
export const matchesBank = (location: Location, romBank: number) =>
  location.bank === null || !isBanked(location.addr) || location.bank === romBank;

const OPERAND = /\(\$FF00\+\$([0-9A-F]{2})\)|\$([0-9A-F]{4})/g;

/** Replaces addresses in a disassembled instruction with their labels, where known. */
export function labelOperands(text: string, symbols: SymbolTable | null, romBank: number): string {
  if (!symbols) return text;
  return text.replace(OPERAND, (whole, high: string | undefined, full: string | undefined) => {
    if (high !== undefined) {
      const label = symbols.labelAt(0xff00 + parseInt(high, 16), romBank);
      return label ? `(${label})` : whole;
    }
    return symbols.labelAt(parseInt(full!, 16), romBank) ?? whole;
  });
}
