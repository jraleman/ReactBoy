// @ts-nocheck
// Read a byte from absolute location into A (LD A, addr)
const LDAmm = (mmu) => {
    // Get address from instr
    const addr = mmu.rw(this._r.pc);
    // Advance PC
    this._r.pc += 2;
    // Read from address
    this._r.a = mmu.rb(addr);
    // 4 M-times taken
    this._r.m = 4; this._r.t = 16;
};

export default LDAmm;
