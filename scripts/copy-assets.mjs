// Copies OCR + PDF assets into public/ so the app never fetches from a third party.
import { cpSync, mkdirSync } from 'node:fs';

const nm = 'node_modules';
const out = 'public/vendor';
mkdirSync(`${out}/ocr`, { recursive: true });

cpSync(`${nm}/tesseract.js/dist/worker.min.js`, `${out}/ocr/worker.min.js`);
for (const f of [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
]) cpSync(`${nm}/tesseract.js-core/${f}`, `${out}/ocr/${f}`);
cpSync(`${nm}/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`, `${out}/ocr/eng.traineddata.gz`);

cpSync(`${nm}/pdfjs-dist/cmaps`, `${out}/pdfjs/cmaps`, { recursive: true });
cpSync(`${nm}/pdfjs-dist/standard_fonts`, `${out}/pdfjs/standard_fonts`, { recursive: true });
console.log('assets copied to', out);
