/** Thrown when save-state data is damaged, for another game, or from an incompatible version. */
export class SaveStateError extends Error {
  override name = 'SaveStateError';
}

/** Something whose full state can be written to and restored from a save state. */
export interface Stateful {
  writeState(w: StateWriter): void;
  readState(r: StateReader): void;
}

/** Appends little-endian fields to a growable buffer. */
export class StateWriter {
  private buffer = new Uint8Array(0x10000);
  private view = new DataView(this.buffer.buffer);
  private pos = 0;

  u8(v: number): void {
    this.reserve(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  u16(v: number): void {
    this.reserve(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  u32(v: number): void {
    this.reserve(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  /** Any JS number, e.g. cycle counts that outgrow 32 bits. */
  f64(v: number): void {
    this.reserve(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  bool(v: boolean): void {
    this.u8(v ? 1 : 0);
  }

  /** A length-prefixed byte block. */
  bytes(data: Uint8Array): void {
    this.u32(data.length);
    this.reserve(data.length);
    this.buffer.set(data, this.pos);
    this.pos += data.length;
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.pos);
  }

  private reserve(n: number): void {
    if (this.pos + n <= this.buffer.length) return;
    const next = new Uint8Array(Math.max(this.buffer.length * 2, this.pos + n));
    next.set(this.buffer);
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }
}

/** Reads fields in the order {@link StateWriter} wrote them; throws on truncated data. */
export class StateReader {
  private readonly view: DataView;
  private pos = 0;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  /** Reads a block written by {@link StateWriter.bytes} into `target`, which must match its size. */
  bytes(target: Uint8Array): void {
    const length = this.u32();
    if (length !== target.length) {
      throw new SaveStateError(`Expected a ${target.length}-byte block, found ${length} bytes.`);
    }
    this.need(length);
    target.set(this.data.subarray(this.pos, this.pos + length));
    this.pos += length;
  }

  get done(): boolean {
    return this.pos === this.data.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.data.length) throw new SaveStateError('Save state is truncated.');
  }
}
