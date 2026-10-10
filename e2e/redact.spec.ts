import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

const FIX = 'e2e/fixtures';
const OUT = 'e2e/fixtures/out';
mkdirSync(OUT, { recursive: true });

// Fail the test if the page tries to talk to any other origin.
async function watchNetwork(page: Page) {
  const foreign: string[] = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !['blob:', 'data:'].includes(u.protocol)) foreign.push(r.url());
  });
  return foreign;
}

async function openFile(page: Page, path: string) {
  await page.goto('/');
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('#editor')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
}

async function findingTexts(page: Page) {
  return page.locator('#findings li').evaluateAll(lis => lis.map(li => li.textContent ?? ''));
}

async function download(page: Page, to: string) {
  const dl = page.waitForEvent('download');
  await page.locator('#download').click();
  await (await dl).saveAs(to);
}

test('text PDF: finds secrets, output is flattened and unreadable', async ({ page }) => {
  const foreign = await watchNetwork(page);
  await openFile(page, `${FIX}/statement.pdf`);

  // Default preset = rental/job application.
  const found = (await findingTexts(page)).join('\n');
  expect(found).toContain('123-45-6789');
  expect(found).toContain('021000021');
  expect(found).toContain('987654'); // account minus last 4
  expect(found).toContain('04/12/1990');
  expect(found).not.toContain('$1,850.00'); // income stays visible for this preset

  await page.locator('#custom').fill('Jane Example');
  await expect(page.locator('#findings')).toContainText('Jane Example');

  await download(page, `${OUT}/statement-redacted.pdf`);

  // No text layer and no leftover metadata.
  const text = execFileSync('pdftotext', [`${OUT}/statement-redacted.pdf`, '-']).toString();
  expect(text.trim()).toBe('');
  const info = execFileSync('pdfinfo', [`${OUT}/statement-redacted.pdf`]).toString();
  expect(info).not.toContain('Jane');

  // Re-open the redacted output: the app has to OCR it, and must find no secrets.
  await openFile(page, `${OUT}/statement-redacted.pdf`);
  const again = (await findingTexts(page)).join('\n');
  for (const secret of ['123-45-6789', '021000021', '9876543210', '04/12/1990']) expect(again).not.toContain(secret);
  // Prove OCR really read the output: unredacted dollar amounts must still be found.
  await page.locator('.presets button', { hasText: 'Maximum' }).click();
  expect((await findingTexts(page)).join('\n')).toContain('2,976.16');

  expect(foreign).toEqual([]);
});

test('screenshot image: OCR finds secrets and the PNG comes out redacted', async ({ page }) => {
  const foreign = await watchNetwork(page);
  await openFile(page, `${FIX}/statement.png`);
  await page.locator('.presets button', { hasText: 'Sharing publicly' }).click();
  const found = (await findingTexts(page)).join('\n');
  for (const s of ['123-45-6789', '021000021', 'jane.example@example.com', '(555) 201-7788', 'IL 62704']) expect(found).toContain(s);
  await download(page, `${OUT}/statement-redacted.png`);

  await openFile(page, `${OUT}/statement-redacted.png`);
  const again = (await findingTexts(page)).join('\n');
  for (const s of ['123-45-6789', '021000021', 'jane.example', '201-7788', '62704']) expect(again).not.toContain(s);
  expect(foreign).toEqual([]);
});

test('scanned PDF: OCR runs automatically', async ({ page }) => {
  await openFile(page, `${FIX}/scanned.pdf`);
  const found = (await findingTexts(page)).join('\n');
  for (const s of ['123-45-6789', '021000021', '04/12/1990']) expect(found).toContain(s);
});

test('manual box and unhide toggle', async ({ page }) => {
  await openFile(page, `${FIX}/statement.pdf`);
  const summary = page.locator('#summary');
  const before = Number((await summary.textContent())!.match(/\d+/)![0]);

  await page.locator('.box').first().click();
  await expect(summary).toContainText(`${before - 1} item`);

  const ov = page.locator('.overlay').first();
  const b = (await ov.boundingBox())!;
  await page.mouse.move(b.x + 300, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 420, b.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(summary).toContainText(`${before} item`);
  await expect(page.locator('.box.manual')).toHaveCount(1);
});
