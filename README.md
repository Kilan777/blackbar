# Blackbar

Redact PDFs and screenshots privately, in the browser. Finds SSNs, account/routing/card numbers,
birth dates, contact details and custom words, lets you review and adjust, then exports a
flattened file where the hidden text is actually gone.

**Privacy model:** a static site with no backend. Files are processed in the tab
(pdf.js for PDFs, tesseract.js for OCR); all assets are self-hosted and a Content-Security-Policy
blocks requests to any other origin. Output pages are re-rendered as images with the boxes burned
in, so no text layer or metadata survives.

```sh
npm install
npm run dev        # local dev server
npm test           # detector unit tests
npm run fixtures   # regenerate fake test documents (needs poppler's pdftoppm)
npm run e2e        # build + browser tests (uses installed Chrome)
npm run build      # static site in dist/
```

Code: `src/detect.ts` (detectors, presets), `src/extract.ts` (PDF text + OCR → character boxes),
`src/export.ts` (flattened output), `src/main.ts` (UI).
