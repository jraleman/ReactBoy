# ReactBoy

A Game Boy (DMG) emulator for the browser. The emulator core is plain TypeScript with no
DOM or React dependencies. It runs in a Web Worker, and React draws the handheld around it.

**Play:** <https://jraleman.com/ReactBoy/>. Load your own `.gb` ROM. Files never leave your
device.

## Status

| Area                                              | State                                                    |
| ------------------------------------------------- | -------------------------------------------------------- |
| CPU (SM83), interrupts, HALT bug, timers, OAM DMA | Passes Blargg `cpu_instrs`, `instr_timing`, `mem_timing` |
| PPU (scanline renderer, window, sprites, STAT)    | Passes `dmg-acid2`                                       |
| Cartridges                                        | ROM only, MBC1, MBC2, MBC3 (with RTC), MBC5              |
| Input                                             | Keyboard, multitouch on-screen buttons, gamepads         |
| Battery saves, save states                        | Kept on the device; `.sav` import/export; auto-resume    |
| Sound (two pulse, wave, noise; AudioWorklet)      | Passes all 12 Blargg `dmg_sound` tests                   |
| Debugger, PWA                                     | Not yet (milestone 8)                                    |

See [the design document](reactboy-design-doc.md) for the full roadmap.

## Getting started

Requires Node 22+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev          # http://localhost:5173/ReactBoy/
```

| Script                               | What it does                                                |
| ------------------------------------ | ----------------------------------------------------------- |
| `pnpm dev`                           | Start the web app with hot reload                           |
| `pnpm build`                         | Type-check and build the site into `apps/web/dist`          |
| `pnpm test`                          | Unit tests for every package, plus the ROM suite if present |
| `pnpm fetch-roms`                    | Download the open test ROMs into `roms/test` (gitignored)   |
| `pnpm lint`                          | ESLint                                                      |
| `pnpm typecheck`                     | `tsc` for every package                                     |
| `pnpm --filter @reactboy/core bench` | Frame-time benchmark against the 8 ms budget                |

## Layout

```
packages/core   @reactboy/core — CPU, MMU, cartridge mappers, PPU, APU, timer, joypad,
                serial, save states
apps/web        @reactboy/web — React UI, worker host, input, canvas, audio, storage
scripts         fetch-test-roms.mjs
```

The core advances the whole machine one M-cycle at a time. Every CPU memory access ticks
the timer, APU, PPU, DMA and serial port, so instruction timing comes from the access
pattern instead of a cycle table. The same opcode tables drive both execution and the
disassembler. The APU's channels catch up lazily, only when a register access, a frame
sequencer step or a due audio sample can observe them. Each component writes its own part
of a versioned save state (`GameBoy.serialize()` / `deserialize()`).

The web app runs the core in a worker (or inline if workers are unavailable).
`requestAnimationFrame` paces it at the DMG's 59.73 Hz, independent of the display's
refresh rate. Each frame comes back as a transferable buffer and is drawn to a 160×144
canvas. React only re-renders on low-frequency changes (status, cartridge, held buttons),
via `useSyncExternalStore`. The LCD is scaled by a whole number of device pixels whenever
that costs little screen space, so pixels stay crisp.

Sound is produced at the device's sample rate and sent with each frame to an AudioWorklet.
It keeps about 60 ms queued and plays up to 0.5% faster or slower to hold that level, so
video pacing and the audio clock never drift apart. Sound plays only at 1× speed.

Games, battery saves and save states live in IndexedDB, keyed by a hash of the ROM so saves
follow the game rather than the file name. Battery RAM is stored about every 2 seconds
while a game writes to it. A resume state is written on pause, when the page is hidden,
before switching games and once a minute. It is only used if it is newer than the battery
save, so a stale state never rolls back an in-game save. `.sav` files use the common layout,
including the 48-byte MBC3 clock block, so they move to and from other emulators. MBC3
clocks catch up on real time that passed between sessions.

## Testing

`pnpm fetch-roms && pnpm test` runs, headlessly in Node:

- Blargg's `cpu_instrs` (all 11), `instr_timing` and `mem_timing`, which report over the
  serial port, and `dmg_sound` (all 12), which reports in cartridge RAM
- `dmg-acid2`, compared pixel for pixel with its reference image
- unit tests for the CPU, timer, PPU timing, APU output, joypad, mappers, disassembler and
  save states, plus the web app's storage, audio queue and save flows

CI runs lint, formatting, type checks, all tests and the build on every push and pull
request, then deploys `master` to GitHub Pages.

## Legal

ReactBoy ships no commercial ROMs and no boot ROM; the emulator starts from the documented
post-boot state. Test ROMs are downloaded from their authors' repositories on demand.
Game Boy is a trademark of Nintendo; this project is not affiliated with Nintendo.

## References

- [Pan Docs](https://gbdev.io/pandocs/), the primary hardware reference
- [gbdev opcode table](https://gbdev.io/gb-opcodes/optables/)
- [Blargg's test ROMs](https://github.com/retrio/gb-test-roms),
  [dmg-acid2](https://github.com/mattcurrie/dmg-acid2),
  [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite)
- [The Ultimate Game Boy Talk (33c3)](https://www.youtube.com/watch?v=HyzD8pNlpwI)
- [Imran Nazar: GameBoy Emulation in JavaScript](http://imrannazar.com/GameBoy-Emulation-in-JavaScript:-The-CPU)
- [Game Boy Emulator Dev: writing a disassembler](https://www.youtube.com/watch?v=eQXUJOkw0s0)
  and [implementing interrupts](https://www.youtube.com/watch?v=bkiB568FfXg)
- [RubyConf AU 2017: Writing a Game Boy emulator in Ruby](https://www.youtube.com/watch?v=WbO2FEpNPvQ)
- Tools: [RGBDS](https://github.com/gbdev/rgbds), [BGB](https://bgb.bircd.org)
- The original shell was inspired by
  [Animated Gameboy in CSS](http://www.bchanx.com/animated-gameboy-in-css-blog)
