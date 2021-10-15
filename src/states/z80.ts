import {
    ADDr_e,
    CPr_b,
    NOP,
} from "../utils/helpers/z80";

// TODO: Move to /states/CPUInitialState?
const z80 = {
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
    },
    ADDr_e,
    CPr_b,
    NOP,
};

export default z80;
