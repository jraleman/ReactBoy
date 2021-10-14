// http://imrannazar.com/GameBoy-Emulation-in-JavaScript:-The-CPU

// The CPU in the original GameBoy is a modified Zilog Z80, so the following things are pertinent:

// The Z80 is an 8-bit chip, so all the internal workings operate on one byte at a time;
// The memory interface can address up to 65,536 bytes (a 16-bit address bus);
// Programs are accessed through the same address bus as normal memory;
// An instruction can be anywhere between one and three bytes.
// In addition to the PC, other numbers are held inside the CPU that can be used for calculation, and they're referred to as registers: A, B, C, D, E, H, and L. 
// Each of them is one byte, so each one can hold a value from 0 to 255. 
// Most of the instructions in the Z80 are used to handle values in these registers:
// loading a value from memory into a register, adding or subtracting values, and so forth.

// --------------------------------------

// TODO: Move to /states/CPUInitialState?
export const z80InitialState = {
    // Time clock
    _clock: {
        // Z80 holds two types of clock (m and t)
        m: 0,
        t: 0
    },
    // Registers
    _r: {
        // 8-bit registers
        a: 0,
        b: 0,
        c: 0,
        d: 0,
        e: 0,
        h: 0,
        l: 0,
        f: 0,
        // 16-bit registers
        pc: 0,
        sp: 0,
        // Clock for last instruction
        m: 0,
        t: 0,     
    }
};

// --------------------------------------
