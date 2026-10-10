// Builds the redacted output by flattening each page to pixels with the black boxes burned in.
// No original text, metadata or hidden layers survive, so the redaction can't be undone.
import { PDFDocument } from 'pdf-lib';
import type { Rect } from './detect';
import type { Page } from './extract';

function burn(page: Page, rects: Rect[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = page.canvas.width;
  c.height = page.canvas.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(page.canvas, 0, 0);
  ctx.fillStyle = '#000';
  for (const r of rects) ctx.fillRect(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w) + 1, Math.ceil(r.h) + 1);
  return c;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality));
}

export async function exportPdf(pages: Page[], rects: Rect[][]): Promise<Blob> {
  const doc = await PDFDocument.create();
  for (const [i, page] of pages.entries()) {
    const jpg = await toBlob(burn(page, rects[i]), 'image/jpeg', 0.92);
    const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const out = doc.addPage([page.widthPt, page.heightPt]);
    out.drawImage(img, { x: 0, y: 0, width: page.widthPt, height: page.heightPt });
  }
  const now = new Date();
  doc.setTitle('Redacted document');
  doc.setProducer('Blackbar');
  doc.setCreator('Blackbar');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** PNG re-encode also drops EXIF data such as GPS location. */
export async function exportImage(page: Page, rects: Rect[]): Promise<Blob> {
  return toBlob(burn(page, rects), 'image/png');
}
