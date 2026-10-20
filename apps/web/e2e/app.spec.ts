import { expect, test } from '@playwright/test';
import { decodeGreyscalePng } from '../../../packages/core/test/helpers/roms';
import {
  expectScreenColor,
  INPUT_ROM,
  loadRom,
  readTestFile,
  screenPixels,
  testRom,
} from './helpers';

/** The classic palette's lightest and darkest shades. */
const LIGHT = 0x9bbc0f;
const DARK = 0x0f380f;

const status = (page: import('@playwright/test').Page) => page.getByRole('status').first();

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('renders dmg-acid2 exactly like the reference image', async ({ page }) => {
  const rom = testRom('dmg-acid2/dmg-acid2.gb');
  const reference = testRom('dmg-acid2/reference-dmg.png');
  test.skip(!rom || !reference, 'run pnpm fetch-roms first');

  // Greyscale shades match the reference image's values.
  await page.getByRole('radio', { name: 'Greyscale' }).check({ force: true });
  await loadRom(page, rom!);
  await expect(page.getByRole('heading', { name: 'DMG-ACID2' })).toBeVisible();

  // The test draws its final image within a few frames and then holds it.
  const expected = Array.from(decodeGreyscalePng(readTestFile(reference!)).pixels);
  await expect
    .poll(async () => {
      const pixels = await screenPixels(page);
      return expected.filter((value, i) => pixels[i * 4] !== value).length;
    })
    .toBe(0);
});

test('keyboard, remapped keys and touch buttons reach the game', async ({ page }) => {
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await expectScreenColor(page, LIGHT);

  await page.keyboard.down('x');
  await expectScreenColor(page, DARK);
  await page.keyboard.up('x');
  await expectScreenColor(page, LIGHT);

  await page.getByRole('button', { name: 'Add a key for A' }).click();
  await page.keyboard.press('k');
  await expect(page.getByText('K now presses A.')).toBeVisible();
  await page.keyboard.down('k');
  await expectScreenColor(page, DARK);
  await page.keyboard.up('k');
  await expectScreenColor(page, LIGHT);

  const a = page.getByRole('button', { name: 'A', exact: true });
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expectScreenColor(page, DARK);
  await page.mouse.up();
  await expectScreenColor(page, LIGHT);
});

test('save states from shortcuts, and resuming after a reload', async ({ page }) => {
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await expect(page.getByRole('heading', { name: 'INPUT TEST' })).toBeVisible();

  await page.keyboard.press('Shift+F1');
  await expect(status(page)).toContainText('Saved to slot 1.');
  await page.keyboard.press('F2');
  await expect(status(page)).toContainText('Slot 2 is empty.');
  await page.keyboard.press('F1');
  await expect(status(page)).toContainText('Loaded slot 1.');
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /^INPUT TEST/ }).click();
  await expect(status(page)).toContainText('Resumed where you left off.');
  await expect(page.getByRole('button', { name: /^Load slot 1, saved/ })).toBeEnabled();
});

test('the debugger stops at breakpoints and steps through code', async ({ page }) => {
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await page.getByRole('button', { name: 'Open debugger' }).click();
  await expect(page.getByRole('heading', { name: 'Debugger' })).toBeFocused();

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('textbox', { name: 'Add to breakpoints' }).fill('0110');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Stopped at breakpoint $0110.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByText('Paused at $0112.')).toBeVisible();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByText('Paused at $0104.')).toBeVisible();

  await page.getByRole('tab', { name: 'I/O' }).click();
  await expect(page.getByRole('row', { name: /^BGP/ })).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Open debugger' })).toBeFocused();
});

test('works offline after the first visit', async ({ page, context }) => {
  await expect(page.getByText('ReactBoy is ready to work offline.')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No cartridge' })).toBeVisible();

  // The worker, fonts and everything else came from the cache too.
  await loadRom(page, { name: 'input.gb', buffer: INPUT_ROM });
  await expectScreenColor(page, LIGHT);
  await expect(page.getByRole('heading', { name: 'INPUT TEST' })).toBeVisible();
});
