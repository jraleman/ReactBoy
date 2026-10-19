# ReactBoy: Modernization Design Document

**Status:** Draft
**Repo:** https://github.com/jraleman/ReactBoy
**Scope:** Bring the project to a modern TypeScript/React stack and implement a working Game Boy (DMG) emulator.

> **Basis of this doc:** I could read the README and `package.json`. GitHub blocked automated access to `src/`, so anything about the source layout is an assumption and should be verified in a code audit (Phase 0).

---

## 1. Current State

| Area | Finding |
|---|---|
| Build | Create React App, `react-scripts 4.0.3` (CRA is deprecated) |
| React | 17.0.2 |
| TypeScript | ^4.1.2, `@types/node` 12 |
| Styling | `styled-components` 5 |
| Tests | Testing Library 11, Jest 26 via CRA; no evidence of emulator tests |
| Deploy | `gh-pages` manual script |
| Package manager | Yarn v1 lockfile |
| Features | README documents a CSS-only Game Boy shell (~50 absolutely-positioned divs, adapted from an "Animated Gameboy in CSS" article) and a component breakdown with a TODO to reduce component count. The References list covers CPU, opcodes, and interrupts, so the emulator core appears to be unfinished or absent. |

### Problems
1. Toolchain is end-of-life (CRA, Webpack 4 era, Jest 26): slow, insecure deps, no modern React features.
2. The shell is purely decorative; there is no ROM loading, execution loop, or rendering path.
3. Component tree mirrors the DOM of the reference CSS art (one component per div), which is hard to maintain and not responsive or accessible.
4. No test strategy for emulator correctness.

---

## 2. Goals and Non-Goals

### Goals
- Modern, strict TypeScript codebase on current React and Vite.
- Working DMG emulator that boots real games and passes standard test ROMs.
- Clean separation: **emulator core is framework-agnostic**; React is only the shell and UI.
- 60 FPS on mid-range phones and laptops.
- Desktop and mobile controls, save persistence, save states.
- CI with automated tests and deploy.

### Non-Goals (v1)
- Game Boy Color, Super Game Boy, link-cable multiplayer.
- Bundling any commercial ROMs. Users load their own; the repo ships only open homebrew/test ROMs.
- Cycle-perfect hardware accuracy beyond what test ROMs require (a later stretch goal).

---

## 3. Target Stack

| Concern | Choice | Rationale |
|---|---|---|
| Bundler/dev server | **Vite** | CRA replacement, fast HMR, first-class Worker support |
| React | Current stable (18/19) | Concurrent features, `useSyncExternalStore` |
| TypeScript | 5.x, `strict`, `noUncheckedIndexedAccess` | Catches buffer/index bugs in the core |
| Styling | **CSS Modules** (or vanilla CSS with variables) | Shell is mostly static; avoids CSS-in-JS runtime cost |
| Unit tests | **Vitest** | Shares Vite config, fast |
| E2E | **Playwright** | Load a test ROM, assert framebuffer hash |
| Lint/format | ESLint (flat config) + `typescript-eslint` + Prettier | |
| Package manager | pnpm (or keep Yarn, upgraded) | |
| CI/CD | GitHub Actions → GitHub Pages | Replace `gh-pages` script |
| PWA | `vite-plugin-pwa` | Offline play, installable |

---

## 4. Architecture

```
┌──────────────────────────── Main thread ───────────────────────────┐
│  React UI shell                                                    │
│   ├─ <GameBoy/>  (screen, buttons, ROM loader, settings)           │
│   ├─ <Debugger/> (optional panels)                                 │
│   └─ useEmulator() hook ──► EmulatorClient (typed RPC)             │
│                                   │ postMessage / SharedArrayBuffer │
└───────────────────────────────────┼────────────────────────────────┘
                                    ▼
┌──────────────────────────── Web Worker ────────────────────────────┐
│  @reactboy/core  (pure TS, no DOM)                                 │
│   CPU · MMU · Cartridge/MBC · PPU · APU · Timer · Joypad · Serial  │
│   Scheduler: runFrame() → 70,224 T-cycles                          │
└────────────────────────────────────────────────────────────────────┘
        │ framebuffer (160×144 RGBA)        │ audio samples
        ▼                                   ▼
   <canvas> (OffscreenCanvas or            AudioWorklet
   transferred ImageBitmap)
```

### Key decisions
1. **Core as a standalone package** (`packages/core`) with zero React/DOM dependencies. Enables Node-based test runs, headless CI, and reuse.
2. **Run the core in a Web Worker** so heavy emulation never blocks React rendering. Fall back to main-thread if workers are unavailable.
3. **React never re-renders per frame.** The screen is a `<canvas>` drawn imperatively. Only low-frequency state (running/paused, ROM title, FPS) flows through React, via `useSyncExternalStore`.
4. **Frame pacing:** run the core at ~59.73 Hz (4,194,304 Hz / 70,224 cycles per frame), driven by `requestAnimationFrame` with an accumulator, audio-clock-driven when audio is enabled.

### Proposed repo layout

```
reactboy/
├─ packages/
│  └─ core/
│     ├─ src/
│     │  ├─ cpu/        registers.ts, opcodes.ts, cb-opcodes.ts, cpu.ts
│     │  ├─ memory/     mmu.ts, memory-map.ts
│     │  ├─ cartridge/  header.ts, mbc0.ts, mbc1.ts, mbc3.ts, mbc5.ts
│     │  ├─ ppu/        ppu.ts, fifo-or-scanline.ts, palette.ts
│     │  ├─ apu/        channels, mixer
│     │  ├─ timer.ts  interrupts.ts  joypad.ts  serial.ts  dma.ts
│     │  ├─ gameboy.ts  (wires everything, exposes runFrame/reset/serialize)
│     │  └─ index.ts
│     └─ test/          unit + ROM-based conformance tests
├─ apps/
│  └─ web/
│     └─ src/
│        ├─ components/ shell/, screen/, controls/, debugger/
│        ├─ hooks/      useEmulator, useGamepad, useKeyboard
│        ├─ worker/     emulator.worker.ts, client.ts
│        ├─ storage/    idb.ts (saves, states, settings)
│        └─ main.tsx
└─ roms/test/           open-source test ROMs only
```

---

## 5. Emulator Core Requirements

> Note: the Game Boy CPU is the **Sharp SM83**, not a Z80. Several of the Z80 references in the README (e.g., Z80 decoding) are useful but not directly applicable; the SM83 lacks shadow registers, IX/IY, and I/O ports.

### 5.1 CPU
- Registers A,F,B,C,D,E,H,L, SP, PC; 16-bit pairs; flags Z/N/H/C (low nibble of F always 0).
- Full 256-entry opcode table plus 256-entry `0xCB` table; correct cycle counts including conditional jumps.
- Table-driven design (opcode → `{mnemonic, length, cycles, execute}`) so the same table powers the disassembler.
- `HALT` (including the HALT bug), `STOP`, `EI` delayed-enable, `DI`, `RETI`.
- Interrupts: VBlank, LCD STAT, Timer, Serial, Joypad; IE/IF registers; priority and vectors.

### 5.2 Memory (MMU)
- Full address-space routing: ROM banks, VRAM, external RAM, WRAM, echo RAM, OAM, I/O registers, HRAM, IE.
- Boot ROM optional; default to the post-boot register state so no proprietary boot ROM is required.
- OAM DMA (`0xFF46`) with correct bus timing/blocking as a later refinement.
- Use typed arrays (`Uint8Array`), avoid per-access allocations.

### 5.3 Cartridge
- Header parsing: title, cartridge type, ROM/RAM size, checksum validation.
- Mappers: **ROM-only, MBC1, MBC3 (with RTC), MBC5** cover the large majority of the library. MBC2 as a follow-up.
- Battery-backed RAM export/import.

### 5.4 PPU
- 160×144 output, 4-shade DMG palette (configurable color themes, including the classic green).
- Modes 0–3 with correct timing (OAM scan 80, draw ~172+, HBlank, VBlank 10 lines); LY/LYC, STAT interrupts.
- Background, window, sprites (8×8 and 8×16), priority and flip flags, 10-sprites-per-line limit.
- Phase 1: scanline renderer. Phase 2 (stretch): pixel FIFO for mid-scanline effects.

### 5.5 Timers
- DIV (16-bit internal counter), TIMA/TMA/TAC with correct falling-edge behavior and overflow reload.

### 5.6 Joypad
- `P1/JOYP` matrix select, joypad interrupt.

### 5.7 APU
- Two pulse channels (one with sweep), wave channel, noise channel, frame sequencer, mixing and NR5x registers.
- Output via `AudioWorklet` with a ring buffer; resample from ~4.19 MHz to the device rate.
- Ship after video works; core must run silently if audio is disabled.

### 5.8 Serial
- Minimal implementation (needed so Blargg's tests, which print over serial, can report results headlessly).

### 5.9 Save states
- `serialize(): Uint8Array` / `deserialize()` on the whole machine with a versioned format.

---

## 6. UI / React Requirements

### 6.1 Shell refactor
- Replace ~50 per-div components with a small set: `GameBoyShell`, `Screen`, `DPad`, `ActionButtons` (A/B), `StartSelect`, `Speaker`, `PowerLED`, `ContrastKnob`.
- Prefer **inline SVG and CSS variables** for decorative parts (screws, chips, gloss) over absolutely positioned divs; decorative elements get `aria-hidden`.
- Responsive: scale by CSS (`--scale`) while keeping the screen at **integer** pixel multiples with `image-rendering: pixelated`.
- Theme variants (the original `green` class, plus classic grey, clear purple, etc.).

### 6.2 Features
| Feature | Details |
|---|---|
| ROM loading | File picker + drag-and-drop; validate header; show title/mapper |
| Controls | Keyboard (remappable), Gamepad API, on-screen touch buttons with multitouch and haptics |
| Emulation | Play/pause/reset, speed (0.5x–4x), frame step |
| Persistence | IndexedDB for battery saves, save states, settings, recent ROMs |
| Display | Palette picker, scale, optional LCD ghosting/grid filter |
| Audio | Volume, mute, per-channel toggles |
| PWA | Offline, installable, file handler where supported |

### 6.3 Debugger (dev-facing, lazy-loaded)
- Register/flag view, disassembler around PC, breakpoints, single-step.
- Memory hex viewer, tile/tilemap viewer, OAM viewer, I/O register view.
- This directly builds on the disassembler and interrupt work the README's references describe.

### 6.4 Accessibility
- Keyboard-operable controls, visible focus, `prefers-reduced-motion` for the power-on animation, labelled buttons, screen-reader status for pause/ROM-loaded events.

---

## 7. Testing Strategy

| Layer | Tooling | Targets |
|---|---|---|
| CPU unit | Vitest + per-opcode JSON test suite (e.g., SingleStepTests `sm83`) | Every opcode, flags, cycles |
| ROM conformance | Headless Node runner, serial/framebuffer output | Blargg `cpu_instrs`, `instr_timing`, `mem_timing`; Mooneye acceptance tests as achievable |
| Graphics | Framebuffer hash comparison | `dmg-acid2` |
| Component | Testing Library | Controls emit correct input events |
| E2E | Playwright | Load ROM, press keys, assert screenshot hash; PWA install |
| Perf | Benchmark script | Frames/sec headless; budget of < ~8 ms/frame desktop |

CI gate: lint, typecheck, unit, headless ROM suite, build.

---

## 8. Milestones

| # | Milestone | Deliverable | Rough effort |
|---|---|---|---|
| 0 | **Audit and baseline** | Inventory `src/`, decide keep/rewrite, snapshot current UI | 1–2 days |
| 1 | **Toolchain migration** | Vite, React latest, TS strict, Vitest, ESLint, CI, Pages deploy; styled-components → CSS Modules | 2–4 days |
| 2 | **Shell refactor** | Reduced component set, responsive, themed, a11y pass | 3–5 days |
| 3 | **Core: CPU + MMU + cartridge (MBC0/1)** | Passes `cpu_instrs` headlessly | 1–2 weeks |
| 4 | **Core: timers, interrupts, PPU** | Renders tests; passes `dmg-acid2`; first playable games | 1–2 weeks |
| 5 | **Worker + canvas + input** | Playable in browser at 60 FPS with keyboard/touch | 3–5 days |
| 6 | **MBC3/5, saves, save states** | Battery saves, IndexedDB, state slots | 3–5 days |
| 7 | **APU + AudioWorklet** | Sound with A/V sync | 1–2 weeks |
| 8 | **Debugger + PWA + polish** | Dev tools, offline, settings | 1 week |
| 9 | **Accuracy stretch** | OAM DMA timing, PPU FIFO, Mooneye pass rate (all 94 pass; FIFO open) | open-ended |

Milestones 3–5 are the critical path to a usable emulator; 6–8 can be parallelized.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Performance in JS (hot CPU loop) | Typed arrays, monomorphic table-driven dispatch, no allocations in the frame loop, Worker isolation; profile early |
| Timing bugs (PPU/timer/interrupt interplay) | Adopt test ROMs from milestone 3; use the T-cycle as the base clock |
| Audio crackle / drift | AudioWorklet ring buffer, drive pacing from audio clock |
| `SharedArrayBuffer` needs COOP/COEP headers (GitHub Pages can't set them) | Default to `postMessage` with transferable buffers; treat SAB as an optimization |
| iOS Safari quirks (audio unlock, touch, storage eviction) | Gesture-gated `AudioContext.resume()`, request persistent storage, test on device |
| Legal exposure | No commercial ROMs or boot ROM in repo; clear README notice |
| Scope creep (GBC, link cable) | Explicit non-goals for v1 |

---

## 10. Open Questions

1. Is any of the existing `src/` worth preserving (e.g., component styling), or is a clean restart cleaner?
2. Monorepo (core + web) or a single package with a `core/` folder? Monorepo is recommended if the core may be published to npm.
3. Target audience: a learning project, a polished product, or a reusable library? This affects how much accuracy and UX investment is justified.
4. Is GBC support desired soon after v1? It affects PPU/APU/MMU abstractions, so it is cheaper to design for now.

---

## 11. References

- Pan Docs (the primary Game Boy hardware reference)
- gbdev.io opcode table and community resources
- Blargg's Game Boy test ROMs; Mooneye Test Suite; `dmg-acid2`
- SingleStepTests `sm83` per-opcode JSON tests
- Existing README references: Imran Nazar's JS emulation series, 33c3 "Ultimate Game Boy Talk", RGBDS, BGB debugger

---

## 12. Implementation Log

### Phase 0 audit (2026-10-18)

With the source available locally, the assumptions in section 1 were checked:

- There was no CSS-art shell in code. `src/` held `App`, a `Screen` with an animated logo, a
  decorative `CPU` chip and an empty `Canvas` div; the 50-div component tree existed only in
  the README.
- The six CPU opcode helpers (`ADDr_e`, `CPr_b`, …) were arrow functions using `this`, so
  they could not run; `@ts-nocheck` hid the errors. The MMU was `console.log` stubs and
  `useGameboy` only set a flag. The one App test was CRA boilerplate.
- Decision: clean restart. Nothing from `src/` was carried over except the boot-logo idea,
  now the empty-screen animation.

### Decisions on the open questions (section 10)

1. Keep vs. restart: restart (see above).
2. Monorepo: yes, pnpm workspaces with `packages/core` and `apps/web`. The core exports its
   TypeScript source directly; a publishable build can be added when needed.
3. Audience: a polished product. UX, mobile controls and performance take priority.
4. GBC: DMG-only for v1, with seams left in place: 32 KiB WRAM with a bank index, palette
   abstraction in the PPU, and a header check that rejects CGB-only carts with a clear
   message.

### Milestones 0–5: done

- **Toolchain:** Vite 8, React 19, TypeScript 5.9 (`strict`, `noUncheckedIndexedAccess`;
  TS 7 is not yet supported by typescript-eslint), Vitest 5, ESLint 10 flat config,
  Prettier, GitHub Actions CI with Pages deploy. CSS Modules replace styled-components.
- **Core:** M-cycle-stepped SM83 with table-driven opcodes that also drive the
  disassembler, plus MMU, timer (falling-edge DIV/TAC and TIMA reload delay), joypad, serial,
  OAM DMA, scanline PPU with STAT edge detection and VRAM/OAM blocking, and mappers ROM,
  MBC1, MBC2, MBC3 (RTC on emulated time) and MBC5. MBC2/3/5 came forward from milestone 6
  because they are small and make many more games playable. Battery-save persistence is
  still milestone 6.
- **Conformance:** all 11 `cpu_instrs`, `instr_timing`, the three `mem_timing` tests and
  `dmg-acid2` pass headlessly. Test ROMs are downloaded by `scripts/fetch-test-roms.mjs`
  rather than committed, because the Blargg mirror carries no license.
- **Performance:** about 4 ms/frame for a worst-case busy loop and about 2 ms/frame for
  `dmg-acid2` on the development machine (Node 24), within the 8 ms budget. Profiling the
  hot path is a follow-up for mid-range phones.
- **Web:** the worker host shares its protocol with an inline fallback. Framebuffers are
  pooled and transferred. Pacing uses requestAnimationFrame with an accumulator and a
  catch-up cap. Keyboard, gamepad and multitouch input (sliding between buttons, haptics)
  are merged per button across sources. The shell is drawn in CSS from a single unit (one
  Game Boy pixel) and snaps to whole device pixels when that costs under 20% of the size.
  Palettes and case colors are remembered in localStorage.

### Milestones 6–7: done (2026-10-18)

Decisions made before starting: store ROM bytes for one-click relaunch, offer three manual
save-state slots plus an automatic resume state, and do M6 before M7.

- **Save states:** each core component writes its own section of one versioned binary
  format (`RBST`, version 1). The header carries the ROM's checksums and a wall-clock
  timestamp. `deserialize` takes a backup first and rolls back on any error. The PPU now
  keeps shades (0–3) and colors frames when presenting them, so states don't depend on the
  palette, and a palette change recolors a paused frame without running the emulator.
- **Battery saves:** the MMU flags writes to cartridge RAM, and the worker host reports
  battery RAM about every 2 seconds while it changes. `.sav` files follow the common
  layout, including the 48-byte MBC3 clock block (44-byte variants are read too). MBC3's
  clock moved into an `Rtc` class that catches up on wall-clock time between sessions, from
  battery saves and from save states. Restart keeps battery RAM, which the old reset
  discarded.
- **Storage (`apps/web/src/storage`):** IndexedDB with separate stores for game metadata,
  ROM bytes, battery saves and states. Games are keyed by a 64-bit content hash in plain JS
  (`crypto.subtle` is missing on plain-HTTP LAN origins). The six most recent ROMs are kept,
  but saves are never deleted automatically. When IndexedDB can't open, an in-memory store
  is used and the UI says that saves won't survive the page. The resume state is written on
  pause, when the page is hidden, before switching games and once a minute. It is only
  restored if it is newer than the battery save, so a crash can't roll back an in-game
  save. The app asks for persistent storage once, for iOS eviction.
- **APU:** two pulse channels (sweep on the first), wave and noise. The frame sequencer is
  clocked by the falling edge of DIV bit 4, including edges caused by DIV writes. All 12
  Blargg `dmg_sound` tests pass, including the DMG wave-RAM timing quirks (access only in
  the cycle the channel fetches; corruption on retrigger). Channels advance lazily, in spans
  that return the integral of their output, so averaging into output samples is exact. They
  only catch up on register access, frame-sequencer steps and due samples. Disabled
  channels stand still, as in SameBoy. A DC-blocking high-pass filter models the output
  capacitor.
- **Audio output:** samples travel with each frame's pixels to the main thread, then to an
  AudioWorklet. Its queue keeps about 60 ms buffered with dynamic rate control (±0.5%),
  fades instead of clicking when it runs dry, and skips ahead when far behind. Pacing stays
  on `requestAnimationFrame`; the rate control absorbs drift, so the audio clock doesn't
  have to drive the frame loop. Sound is generated only while audible: running, at 1×, and
  not muted. It starts on the first gesture. On iOS, `navigator.audioSession` is set to
  `playback` so the silent switch doesn't mute it.
- **Performance:** after the lazy APU, about 2.3 ms/frame for the busy loop (was 2.1) and
  1.5 ms/frame for `dmg-acid2` (was 1.3), with or without 48 kHz output. The benchmark now
  includes the audio case.

### Milestone 8: done (2026-10-19)

Decisions made before starting: cover the debugger, PWA, input polish and Playwright E2E in
one round; make the debugger available to everyone on the live site, lazy-loaded behind a
panel button; go to the full depth of section 6.3; and have updates prompt the player and
never reload mid-game.

- **Debugger core:** `Debugger` in `packages/core/src/debug.ts` wraps a `GameBoy` with PC
  breakpoints, write watchpoints (via an `onWrite` hook that is null otherwise), step into,
  step over (CALL/RST, recursion-safe by also checking SP) and step out (a return that pops
  past the routine's frame). Its `runFrame` replaces the machine's while it is attached, so
  normal play pays nothing; the benchmark is unchanged. Continuing from a stop runs the
  instruction there rather than stopping on it again. `GameBoy.peek()` reads memory without
  side effects: VRAM and OAM regardless of PPU mode or DMA, and APU registers without
  catching the channels up or applying the wave-RAM access rules. Breakpoints match a CPU
  address in whatever bank is mapped.
- **Debugger plumbing:** the worker attaches a debugger only while the panel is open. With a
  frame it can send a snapshot (registers, CPU state, ROM bank and all 64 KiB via `peek`):
  on every stop and step, and about 10 times a second while running. The client keeps
  debugger state in its own `useSyncExternalStore` store, so those updates re-render only
  the debugger. A breakpoint pauses the game like the Pause button, including the resume
  state.
- **Debugger UI:** it takes over the panel's column, so the screen stays in view while
  stepping. Tabs: CPU (registers with changes highlighted, flags, IE/IF, stack, a
  disassembly that decodes backwards by finding a start point that lands on PC, breakpoint
  gutter, breakpoint and watchpoint lists), Memory (a virtualized hex view of the address
  space with region shortcuts, change highlighting and a stop-on-write toggle), Tiles,
  Background (either map, through BGP, with the scroll viewport and window outlined),
  Sprites (OAM with previews through OBP0/1 and flips) and I/O (every register with its bits
  in words, palettes as swatches, wave RAM). It is a 24 KB chunk loaded on first open.
- **Input:** the keymap lives in the settings and can be edited in the panel: press a key to
  bind it to a button, moving it from another if needed; Escape cancels. F1–F3 load a save
  state, Shift+F1–F3 save one (the mGBA/VBA convention) and P pauses; those keys plus Tab and
  Escape can't be bound. Settings from localStorage are validated field by field.
- **PWA:** `vite-plugin-pwa` (generateSW) precaches the whole build, including the worker,
  the audio worklet and fonts, about 870 KiB. Updates use `registerType: 'prompt'`: a banner
  offers the new version, and accepting it pauses, stores the resume state and reloads into
  the same game. "Later" leaves the new version to install the next time the app starts.
  The manifest has maskable icons and a `.gb`/`.gbc` file handler served through the launch
  queue.
- **E2E:** Playwright in Chromium against `vite preview` of the production build, in CI after
  the build and before deploy. It checks `dmg-acid2` pixel for pixel on the canvas;
  keyboard, remapped keys and touch input, using a generated ROM that turns the screen dark
  while A is held; save-state shortcuts and resuming after a reload; breakpoints and stepping
  in the debugger; and loading a game offline after the first visit. The update prompt is
  covered by a unit test, because an end-to-end test would need two builds.

### Milestone 9: Mooneye pass (2026-10-19)

Scope agreed before starting: add the Mooneye acceptance suite to the ROM tests, fix what is
practical, and record what is left. A pixel FIFO was left out.

- **Suite:** `fetch-test-roms.mjs` downloads Mooneye build `mts-20260714-0944-31510e1`
  (the project only publishes whole-suite archives, so the script reads the `.tar.gz` itself)
  and keeps `acceptance/` and the MBC tests. `test/roms/mooneye.test.ts` runs every test that
  applies to a DMG ABC without a boot ROM: unsuffixed, or suffixed with a `G` or `dmgABC`
  model. A test ends at `LD B,B` and passes when B-L hold the Fibonacci numbers 3-34.
- **Result:** from 64 of 94 to all 94 (66 acceptance, 28 MBC). The fixes, each found by
  instrumenting the failing ROM:
  - **OAM DMA** was a cycle early at both ends: the M-cycle after the write is setup, with
    OAM still free, and OAM stays blocked through the M-cycle after the last copy. This
    alone fixed 16 tests, mostly the CPU `*_timing` ones, which use DMA to observe pushes.
  - **TAC writes** take effect before the counter advances in their M-cycle, so enabling
    the timer on the cycle its bit falls counts that edge (`rapid_toggle`). `Timer.tick`
    still runs first; `writeTac` makes up the difference using the counter's previous value.
  - **PPU line timing** follows `lcdon_timing`'s table: LY changes at dot 0, but STAT reads
    mode 0 and LY=LYC reads false until dot 4, while OAM reads are already blocked and the
    mode 2 interrupt fires. VRAM reads block at dot 80 and mode 3 shows at 84. OAM and VRAM
    writes have their own windows (`lcdon_write_timing`), so the PPU keeps four lock bits.
    The first line after the LCD turns on starts 4 dots in and has no OAM scan.
  - **Mode 3 length** is 253 dots + (SCX mod 8) + 6 for the window + Pan Docs' sprite
    penalties, rounded up to the M-cycle. The HBlank interrupt is raised a dot earlier,
    which `intr_2_0_timing` and `hblank_ly_scx_timing` both need. Everything is still
    drawn in one go when mode 3 starts; only the timing moved.
  - **STAT:** the LY=LYC flag and the interrupt line keep their values while the LCD is
    off (`stat_lyc_onoff`), and the mode 2 source also fires at line 144 (`vblank_stat_intr`).
  - **LY=153:** LY reads 153 for one M-cycle, then 0; LYC=153 matches at dot 4 and LYC=0 at
    dot 12. No DMG acceptance test covers this, so it follows the commonly documented timing.
  - **Boot state:** the internal counter starts at 0xABC8 rather than 0xABCC (`boot_div`)
    and P1 reads 0xCF (`boot_hwio`).
  - **Serial** bits shift on the divider clock (just before bit 8 of the counter falls),
    so a transfer's length depends on the counter's phase (`boot_sclk_align`).
  - **MBC1 multicarts** (MBC1M) are detected the usual way (1 MiB with a second Nintendo
    logo at 0x40104) and wire BANK2 one bit lower.
- **Save states** carry the new PPU and serial fields, so `STATE_VERSION` is now 2. States
  from development builds are rejected with the usual message; none had shipped.
- **Cost:** about 3-5% slower (`dmg-acid2` 1.52 → 1.57 ms/frame in back-to-back runs, still
  over 10x real time), from more per-M-cycle branching in the PPU and DMA.
- Unit tests cover each fix without needing the downloaded ROMs.

### Polish: debugger extras and gamepad remapping (2026-10-19)

Decided before starting: memory editing covers RAM and I/O but never ROM; a symbol file is
kept per game on the device; one gamepad layout is shared by every controller.

- **Breakpoints** take an optional ROM bank, typed as `03:4567`. It only means something in
  switchable ROM (0x4000-0x7FFF) and is matched against the bank actually mapped there,
  wrapped to the ROM's size; debug snapshots now report that bank too. A breakpoint set
  from the disassembly gutter in that area is for the bank on screen.
- **Watchpoints** stop on reads, writes or both (R/W toggles per watchpoint, and "Stop on
  read" / "Stop on write" in the memory view). Reads come from a `GameBoy.onRead` hook that
  is null unless a read watchpoint exists, like `onWrite`; the benchmark is unchanged. The
  instruction's own opcode and operand fetches are not data reads and don't trigger one.
- **Memory editing** (`GameBoy.poke`, while paused): VRAM and OAM regardless of PPU mode or
  DMA, RAM, HRAM, and I/O registers written as the CPU would, with their side effects. ROM
  and the unusable area are refused. When the byte reads back differently (read-only
  register bits, disabled cartridge RAM) the view says what it reads instead.
- **Symbols:** an RGBDS `.sym` file loaded in the debugger is validated, kept in a new
  IndexedDB store (schema version 2, upgraded in place) and reloaded with the game. Labels
  head their lines in the disassembly, replace addresses in operands (including
  `($FF00+n)`), appear next to breakpoints, watchpoints and the selected byte, and are
  accepted wherever an address is typed. Same-address labels in switchable ROM are told
  apart by bank; a routine's own name is preferred to its local labels.
- **Gamepads:** the controller layout is a setting, edited like the keyboard's (the two
  share a list component): press a controller button to bind it. Buttons are named by
  standard-mapping position (Face ↓, L1, D-pad ↑…), since printed labels differ by maker.
  A button already held when binding starts only counts once it is pressed again, and
  controller input doesn't reach the game while binding. The left stick stays the d-pad.
- The debugger chunk grew from 24 to 29 KB.

### Not yet done / follow-ups

- Mid-scanline PPU effects (a pixel FIFO): register writes during mode 3 still apply to the
  whole line. The timing tests pass without one.
- Not run from Mooneye: tests for other models (DMG0, MGB, SGB, CGB, AGB: the
  suffixed `acceptance/` tests, `misc/` and `madness/`), and `manual-only/`, which is
  checked by eye against screenshots.
- Smaller timing details no test ROM here covers: OAM DMA bus conflicts (the CPU reading
  the DMA's source bus), window tile alignment in the sprite penalty, and a DIV reset
  clocking the serial port.
- APU obscura not covered by the test ROMs: envelope "zombie mode" writes and the
  sub-M-cycle timing of square-channel triggers.
- Debugger: conditional breakpoints, editing registers, and banked watchpoints for
  cartridge RAM.
- One-time GitHub setting: Pages source must be switched to "GitHub Actions" for the new
  deploy job (previously the `gh-pages` branch).
