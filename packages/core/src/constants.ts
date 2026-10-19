/** Master clock of the DMG in T-cycles per second. */
export const CLOCK_HZ = 4_194_304;
/** T-cycles in one full frame: 154 lines of 456 dots. */
export const CYCLES_PER_FRAME = 70_224;
/** Frames per second the hardware produces (~59.73). */
export const FRAME_RATE = CLOCK_HZ / CYCLES_PER_FRAME;

export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;
