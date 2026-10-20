import { expect, test, type Page } from '@playwright/test';
import { expectScreenColor, INPUT_ROM, loadRom, makeRom } from './helpers';

/** The classic palette, lightest to darkest. */
const SHADES = [0x9bbc0f, 0x8bac0f, 0x306230, 0x0f380f];

/**
 * Link-cable ROMs. Each shows the byte it received as its background palette (BGP), so the
 * blank screen's shade is that byte's low two bits. The clocking side retries until a
 * partner answers (unanswered transfers read $FF).
 */
const LINK_CLOCK = makeRom(
  [
    ...[0x3e, 0x42, 0xe0, 0x01], // retry: LD A,$42; LDH (SB),A
    ...[0x3e, 0x81, 0xe0, 0x02], // LD A,$81; LDH (SC),A — transfer on this side's clock
    ...[0xf0, 0x02, 0xcb, 0x7f, 0x20, 0xfa], // wait: LDH A,(SC); BIT 7,A; JR NZ,wait
    ...[0xf0, 0x01, 0xfe, 0xff, 0x28, 0xec], // LDH A,(SB); CP $FF; JR Z,retry
    ...[0xe0, 0x47, 0x18, 0xfe], // LDH (BGP),A; spin
  ],
  'LINK CLOCK',
);
const LINK_WAIT = makeRom(
  [
    ...[0x3e, 0x99, 0xe0, 0x01], // LD A,$99; LDH (SB),A
    ...[0x3e, 0x80, 0xe0, 0x02], // LD A,$80; LDH (SC),A — wait for the partner's clock
    ...[0xf0, 0x02, 0xcb, 0x7f, 0x20, 0xfa], // wait: LDH A,(SC); BIT 7,A; JR NZ,wait
    ...[0xf0, 0x01, 0xe0, 0x47, 0x18, 0xfe], // LDH A,(SB); LDH (BGP),A; spin
  ],
  'LINK WAIT',
);

const box = async (page: Page, name: string | RegExp, role: 'dialog' | 'img' = 'img') =>
  (await page.getByRole(role, { name }).boundingBox())!;

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('a clear case explains its parts without covering the screen', async ({ page }) => {
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await page.getByRole('radio', { name: 'Atomic Purple' }).check({ force: true });

  // Wide: the explainer sits beside the device.
  await page.getByRole('button', { name: 'CPU (DMG-CPU)' }).click();
  await expect(page.getByRole('dialog', { name: 'CPU (DMG-CPU)' })).toContainText('PC');
  const lcd = await box(page, /game screen/);
  const card = await box(page, 'CPU (DMG-CPU)', 'dialog');
  expect(card.x).toBeGreaterThanOrEqual(lcd.x + lcd.width);

  // The tour walks the parts from the cartridge on.
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Cartridge slot & MBC' })).toContainText('1 of');
  await page
    .getByRole('navigation', { name: 'Tour' })
    .getByRole('button', { name: 'Next' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Crystal oscillator' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Narrow: a sheet over the controls, below the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Work RAM' }).click();
  const sheet = await box(page, 'Work RAM', 'dialog');
  const narrowLcd = await box(page, /game screen/);
  expect(sheet.y).toBeGreaterThanOrEqual(narrowLcd.y + narrowLcd.height);
});

test('the board lights up with the game, and freezes when paused', async ({ page }) => {
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await page.getByRole('radio', { name: 'Smoke Black' }).check({ force: true });
  const board = page.locator('[data-running]').filter({ has: page.locator('svg') });
  // The ROM polls the joypad from ROM non-stop: the CPU and cartridge bus are busy.
  await expect
    .poll(async () => (await board.getAttribute('style')) ?? '')
    .toMatch(/--cpu: 1\.00;.*--cart: [01]\.\d\d;.*--lcd: 1\.00/);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(board).toHaveCount(0);
});

test('the power switch turns the console off, and on again from the start', async ({ page }) => {
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await expectScreenColor(page, SHADES[0]!);
  const power = page.getByRole('switch', { name: 'Power' });
  await expect(power).toHaveAttribute('aria-checked', 'true');

  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('img', { name: /game screen/ })).toBeHidden();
  await expect(page.getByText('Switched off. Turning it back on')).toBeVisible();

  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await expectScreenColor(page, SHADES[0]!);
});

test('the link cable connects two windows’ games', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('./');
  await loadRom(page, { name: 'clock.gb', buffer: LINK_CLOCK });
  await loadRom(other, { name: 'wait.gb', buffer: LINK_WAIT });

  for (const p of [page, other]) {
    await p.getByRole('button', { name: 'Connect cable' }).click();
  }
  for (const p of [page, other]) {
    await expect(p.getByText(/^Connected to another window\. Keep both in view/)).toBeVisible();
  }

  // $99 reached the clocking side (shade 1); $42 reached the waiting side (shade 2).
  await expectScreenColor(page, SHADES[1]!);
  await expectScreenColor(other, SHADES[2]!);
});
