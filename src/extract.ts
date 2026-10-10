// Loads PDFs/images into rendered pages with per-character boxes. Everything stays in this tab.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText, Rect } from './detect';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Absolute URL of a self-hosted asset (workers resolve relative paths against themselves). */
const asset = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;
/** Render scale for PDFs: 2 ≈ 144 DPI, sharp enough to print and read. */
const PDF_SCALE = 2;
const MAX_IMAGE_SIDE = 3500;

export interface Page {
  canvas: HTMLCanvasElement;
  /** Output page size in PDF points (only meaningful for PDFs). */
  widthPt: number;
  heightPt: number;
  /** One entry per text source (PDF text layer, OCR). */
  texts: PageText[];
  ocrDone: boolean;
}

export interface LoadedDoc { kind: 'pdf' | 'image'; name: string; pages: Page[] }

export type Progress = (msg: string, fraction?: number) => void;

export async function loadFile(file: File, progress: Progress, askPassword: () => string | null): Promise<LoadedDoc> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) return loadPdf(file, progress, askPassword);
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) return loadImage(file, progress);
  throw new Error('Unsupported file type. Use a PDF, PNG, JPG or WebP.');
}

async function loadPdf(file: File, progress: Progress, askPassword: () => string | null): Promise<LoadedDoc> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    cMapUrl: asset('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/'),
  });
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const pw = askPassword();
    if (pw === null) { task.destroy(); return; }
    void reason;
    update(pw);
  };
  const pdf = await task.promise;
  const pages: Page[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progress(`Reading page ${n} of ${pdf.numPages}…`, (n - 1) / pdf.numPages);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: PDF_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const base = page.getViewport({ scale: 1 });
    const text = pdfPageText(await page.getTextContent(), vp);
    pages.push({ canvas, widthPt: base.width, heightPt: base.height, texts: [text], ocrDone: false });
    page.cleanup();
  }
  await pdf.destroy();
  return { kind: 'pdf', name: file.name, pages };
}

type TextContent = Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>;

function pdfPageText(tc: TextContent, vp: pdfjs.PageViewport): PageText {
  let text = '';
  const boxes: (Rect | null)[] = [];
  const push = (s: string, b: Rect | null) => { text += s; boxes.push(b); };
  let prev: { y: number; right: number; h: number } | null = null;

  for (const item of tc.items) {
    if (!('str' in item)) continue;
    const [, , c, d, e, f] = item.transform as number[];
    const fontH = Math.hypot(c, d) || item.height || 10;
    if (item.str.length) {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle([e, f - 0.22 * fontH, e + item.width, f + 0.9 * fontH]);
      const r: Rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      if (prev && text.length && !text.endsWith('\n')) {
        const newLine = Math.abs(r.y - prev.y) > prev.h * 0.5 || r.x < prev.right - prev.h;
        if (newLine) push('\n', null);
        else if (r.x - prev.right > r.h * 0.15 && !text.endsWith(' ') && !item.str.startsWith(' ')) push(' ', null);
      }
      const n = item.str.length;
      for (let i = 0; i < n; i++) {
        push(item.str[i], { x: r.x + (r.w * i) / n, y: r.y, w: r.w / n, h: r.h });
      }
      prev = { y: r.y, right: r.x + r.w, h: r.h };
    }
    if (item.hasEOL && text.length && !text.endsWith('\n')) push('\n', null);
  }
  return { text, boxes };
}

async function loadImage(file: File, progress: Progress): Promise<LoadedDoc> {
  progress('Opening image…');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  // 72 pt per inch at an assumed 150 DPI, only used if the image is exported as PDF.
  const page: Page = { canvas, widthPt: canvas.width * 0.48, heightPt: canvas.height * 0.48, texts: [], ocrDone: false };
  return { kind: 'image', name: file.name, pages: [page] };
}

/** Pages whose text layer is (nearly) empty — scans and photos — need OCR. */
export function needsOcr(p: Page): boolean {
  if (p.ocrDone) return false;
  const chars = p.texts.reduce((n, t) => n + t.text.replace(/\s/g, '').length, 0);
  return chars < 25;
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<OcrWorker> | null = null;
let ocrListener: ((pct: number) => void) | null = null;

function getWorker(): Promise<OcrWorker> {
  workerPromise ??= import('tesseract.js').then(({ createWorker, OEM }) =>
    createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: asset('vendor/ocr/worker.min.js'),
      corePath: asset('vendor/ocr/'),
      langPath: asset('vendor/ocr/'),
      workerBlobURL: false,
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') ocrListener?.(m.progress);
      },
    }));
  return workerPromise;
}

interface OcrWord { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface OcrLine { words: OcrWord[] }

/** Run OCR on a page and add the recognised text as another text source. */
export async function ocrPage(p: Page, onProgress: (pct: number) => void): Promise<void> {
  const worker = await getWorker();
  ocrListener = onProgress;
  try {
    const { data } = await worker.recognize(p.canvas, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const block of (data as any).blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const line of para.lines ?? []) lines.push(line);

    let text = '';
    const boxes: (Rect | null)[] = [];
    for (const line of lines) {
      for (const [wi, w] of line.words.entries()) {
        if (wi > 0) { text += ' '; boxes.push(null); }
        const { x0, y0, x1, y1 } = w.bbox;
        const n = w.text.length;
        for (let i = 0; i < n; i++) {
          text += w.text[i];
          boxes.push({ x: x0 + ((x1 - x0) * i) / n, y: y0, w: (x1 - x0) / n, h: y1 - y0 });
        }
      }
      text += '\n'; boxes.push(null);
    }
    p.texts.push({ text, boxes });
    p.ocrDone = true;
  } finally {
    ocrListener = null;
  }
}
