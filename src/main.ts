import './style.css';
import { CATEGORY_LABELS, Category, detect, PRESETS, Rect, spanRects } from './detect';
import { LoadedDoc, loadFile, needsOcr, ocrPage } from './extract';
import { exportImage, exportPdf } from './export';

interface Finding { id: string; page: number; category: Category; text: string; rects: Rect[] }

const CATEGORY_ORDER: Category[] = ['ssn', 'account', 'routing', 'card', 'idnum', 'dob', 'email', 'phone', 'address', 'amount', 'custom'];

const state = {
  doc: null as LoadedDoc | null,
  preset: 'application' as string | null,
  categories: new Set<Category>(PRESETS.application.categories),
  keepLast4: PRESETS.application.keepLast4,
  customTerms: [] as string[],
  findings: [] as Finding[],
  /** Finding ids the user un-hid. */
  disabled: new Set<string>(),
  /** Boxes the user drew, per page, in canvas pixels. */
  manual: [] as Rect[][],
  busy: false,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const landing = $('landing'), editor = $('editor');
const fileInput = $<HTMLInputElement>('file'), dropzone = $('dropzone');
const pagesEl = $('pages'), findingsEl = $('findings'), summaryEl = $('summary');
const statusEl = $('status'), statusText = $('status-text'), statusBar = $<HTMLProgressElement>('status-bar');
const downloadBtn = $<HTMLButtonElement>('download'), ocrBtn = $<HTMLButtonElement>('ocr');
const keep4 = $<HTMLInputElement>('keep4'), custom = $<HTMLTextAreaElement>('custom');

// ---------- file loading ----------

dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void open(f); fileInput.value = ''; });
for (const ev of ['dragenter', 'dragover'] as const)
  window.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('over'); });
for (const ev of ['dragleave', 'drop'] as const)
  window.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('over'); });
window.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) void open(f); });

$('reset').addEventListener('click', () => {
  state.doc = null; state.findings = []; state.manual = []; state.disabled.clear();
  pagesEl.replaceChildren();
  editor.hidden = true; landing.hidden = false;
});

function setStatus(msg: string | null, fraction?: number) {
  statusEl.hidden = msg === null;
  if (msg === null) return;
  statusText.textContent = msg;
  if (fraction === undefined) statusBar.removeAttribute('value');
  else statusBar.value = fraction;
}

async function open(file: File) {
  if (state.busy) return;
  const err = $('landing-error');
  err.hidden = true;
  state.busy = true;
  editor.dataset.state = 'loading';
  landing.hidden = true; editor.hidden = false;
  pagesEl.replaceChildren();
  $('filename').textContent = file.name;
  try {
    const doc = await loadFile(file, setStatus, () => prompt('This PDF is password protected. Enter its password:'));
    state.doc = doc;
    state.manual = doc.pages.map(() => []);
    state.disabled.clear();
    $('ocr-group').hidden = doc.kind !== 'pdf';
    renderPages();
    recompute();
    const scans = doc.pages.filter(needsOcr);
    if (scans.length) await runOcr(scans.map(p => doc.pages.indexOf(p)));
    setStatus(null);
    editor.dataset.state = 'ready';
  } catch (e) {
    editor.hidden = true; landing.hidden = false;
    err.textContent = `Couldn't open that file: ${(e as Error).message ?? e}`;
    err.hidden = false;
    setStatus(null);
  } finally {
    state.busy = false;
  }
}

async function runOcr(pageIdx: number[]) {
  const doc = state.doc!;
  downloadBtn.disabled = true;
  ocrBtn.disabled = true;
  try {
    for (const [k, i] of pageIdx.entries()) {
      const label = `Reading text from ${doc.kind === 'image' ? 'image' : `page ${i + 1}`} (${k + 1}/${pageIdx.length})…`;
      setStatus(label, 0);
      await ocrPage(doc.pages[i], pct => setStatus(label, pct));
      recompute();
    }
  } finally {
    setStatus(null);
    downloadBtn.disabled = false;
    ocrBtn.disabled = false;
  }
}

ocrBtn.addEventListener('click', () => {
  const doc = state.doc;
  if (!doc) return;
  const todo = doc.pages.map((p, i) => (p.ocrDone ? -1 : i)).filter(i => i >= 0);
  if (todo.length) void runOcr(todo);
  ocrBtn.hidden = true;
});

// ---------- options ----------

function renderPresets() {
  const el = $('presets');
  el.replaceChildren(...Object.entries(PRESETS).map(([key, p]) => {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.setAttribute('aria-pressed', String(state.preset === key));
    b.addEventListener('click', () => {
      state.preset = key;
      state.categories = new Set(p.categories);
      state.keepLast4 = p.keepLast4;
      syncControls();
      recompute();
    });
    return b;
  }));
  $('preset-hint').textContent = state.preset ? PRESETS[state.preset].hint : 'Custom selection.';
}

function renderCategories() {
  const counts = new Map<Category, number>();
  for (const f of state.findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  $('categories').replaceChildren(...CATEGORY_ORDER.map(cat => {
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.categories.has(cat);
    box.addEventListener('change', () => {
      if (box.checked) state.categories.add(cat); else state.categories.delete(cat);
      state.preset = null;
      renderPresets();
      recompute();
    });
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = state.categories.has(cat) ? String(counts.get(cat) ?? 0) : '';
    label.append(box, ` ${CATEGORY_LABELS[cat]}`, count);
    return label;
  }));
}

function syncControls() {
  keep4.checked = state.keepLast4;
  renderPresets();
  renderCategories();
}

keep4.addEventListener('change', () => { state.keepLast4 = keep4.checked; state.preset = null; renderPresets(); recompute(); });
let customTimer = 0;
custom.addEventListener('input', () => {
  clearTimeout(customTimer);
  customTimer = window.setTimeout(() => {
    state.customTerms = custom.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    recompute();
  }, 250);
});

// ---------- detection ----------

function recompute() {
  const doc = state.doc;
  if (!doc) return;
  const opts = { categories: state.categories, keepLast4: state.keepLast4, customTerms: state.customTerms };
  state.findings = [];
  doc.pages.forEach((page, pi) => {
    page.texts.forEach((pt, si) => {
      for (const m of detect(pt.text, opts)) {
        const rects = spanRects(pt, m.start, m.end);
        if (rects.length) state.findings.push({ id: `${pi}:${si}:${m.start}:${m.end}:${m.category}`, page: pi, category: m.category, text: m.text, rects });
      }
    });
  });
  renderCategories();
  renderOverlays();
  renderFindings();
}

// ---------- pages & overlays ----------

const overlays: HTMLDivElement[] = [];

function renderPages() {
  const doc = state.doc!;
  overlays.length = 0;
  pagesEl.replaceChildren(...doc.pages.map((page, pi) => {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.style.aspectRatio = `${page.canvas.width} / ${page.canvas.height}`;
    if (doc.pages.length > 1) {
      const no = document.createElement('span');
      no.className = 'pageno';
      no.textContent = `Page ${pi + 1}`;
      wrap.append(no);
    }
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    attachDrawing(overlay, pi);
    overlays.push(overlay);
    wrap.append(page.canvas, overlay);
    return wrap;
  }));
}

function boxEl(r: Rect, pi: number, cls: string): HTMLDivElement {
  const { width, height } = state.doc!.pages[pi].canvas;
  const d = document.createElement('div');
  d.className = `box ${cls}`;
  Object.assign(d.style, {
    left: `${(r.x / width) * 100}%`, top: `${(r.y / height) * 100}%`,
    width: `${(r.w / width) * 100}%`, height: `${(r.h / height) * 100}%`,
  });
  return d;
}

function renderOverlays() {
  overlays.forEach((ov, pi) => {
    const kids: HTMLElement[] = [];
    for (const f of state.findings.filter(f => f.page === pi)) {
      const off = state.disabled.has(f.id);
      for (const r of f.rects) {
        const d = boxEl(r, pi, off ? 'off' : '');
        d.dataset.id = f.id;
        d.title = `${CATEGORY_LABELS[f.category]}: click to ${off ? 'hide again' : 'unhide'}`;
        d.addEventListener('pointerdown', e => e.stopPropagation());
        d.addEventListener('click', () => toggle(f.id));
        kids.push(d);
      }
    }
    state.manual[pi].forEach((r, mi) => {
      const d = boxEl(r, pi, 'manual');
      d.title = 'Your box: click to remove';
      d.addEventListener('pointerdown', e => e.stopPropagation());
      d.addEventListener('click', () => { state.manual[pi].splice(mi, 1); renderOverlays(); renderFindings(); });
      kids.push(d);
    });
    ov.replaceChildren(...kids);
  });
}

function toggle(id: string) {
  if (state.disabled.has(id)) state.disabled.delete(id); else state.disabled.add(id);
  renderOverlays();
  renderFindings();
}

function attachDrawing(overlay: HTMLDivElement, pi: number) {
  let start: { x: number; y: number } | null = null;
  let ghost: HTMLDivElement | null = null;
  const toCanvas = (e: PointerEvent) => {
    const b = overlay.getBoundingClientRect();
    const c = state.doc!.pages[pi].canvas;
    return {
      x: Math.max(0, Math.min(c.width, ((e.clientX - b.left) / b.width) * c.width)),
      y: Math.max(0, Math.min(c.height, ((e.clientY - b.top) / b.height) * c.height)),
    };
  };
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect =>
    ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  overlay.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    overlay.setPointerCapture(e.pointerId);
    start = toCanvas(e);
    ghost = boxEl({ ...start, w: 0, h: 0 }, pi, 'drawing');
    overlay.append(ghost);
  });
  overlay.addEventListener('pointermove', e => {
    if (!start || !ghost) return;
    const r = rectFrom(start, toCanvas(e));
    const fresh = boxEl(r, pi, 'drawing');
    ghost.replaceWith(fresh);
    ghost = fresh;
  });
  const finish = (e: PointerEvent) => {
    if (!start) return;
    const r = rectFrom(start, toCanvas(e));
    start = null;
    ghost?.remove(); ghost = null;
    if (r.w > 6 && r.h > 6) { state.manual[pi].push(r); renderOverlays(); renderFindings(); }
  };
  overlay.addEventListener('pointerup', finish);
  overlay.addEventListener('pointercancel', () => { start = null; ghost?.remove(); ghost = null; });
}

function renderFindings() {
  const active = state.findings.filter(f => !state.disabled.has(f.id)).length;
  const manual = state.manual.reduce((n, m) => n + m.length, 0);
  const total = active + manual;
  summaryEl.textContent = total
    ? `${total} item${total === 1 ? '' : 's'} will be blacked out.`
    : 'Nothing is selected to hide yet.';
  findingsEl.replaceChildren(...state.findings.map(f => {
    const li = document.createElement('li');
    li.className = state.disabled.has(f.id) ? 'off' : '';
    const pageTag = (state.doc?.pages.length ?? 0) > 1 ? ` (p.${f.page + 1})` : '';
    li.innerHTML = `<span class="cat"></span> <code></code>`;
    li.querySelector('.cat')!.textContent = `${CATEGORY_LABELS[f.category]}${pageTag}:`;
    li.querySelector('code')!.textContent = f.text.replace(/\s+/g, ' ');
    li.title = 'Show on page';
    li.addEventListener('click', () => {
      const el = overlays[f.page]?.querySelector<HTMLElement>(`[data-id="${CSS.escape(f.id)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 2000);
    });
    return li;
  }));
}

// ---------- export ----------

downloadBtn.addEventListener('click', async () => {
  const doc = state.doc;
  if (!doc || state.busy) return;
  const rects = doc.pages.map((_, pi) => [
    ...state.findings.filter(f => f.page === pi && !state.disabled.has(f.id)).flatMap(f => f.rects),
    ...state.manual[pi],
  ]);
  if (!rects.some(r => r.length) && !confirm('Nothing is selected to hide. Download a clean copy anyway?')) return;
  state.busy = true;
  downloadBtn.disabled = true;
  setStatus('Building your redacted file…');
  try {
    const base = doc.name.replace(/\.[^.]+$/, '');
    const [blob, name] = doc.kind === 'pdf'
      ? [await exportPdf(doc.pages, rects), `${base}-redacted.pdf`]
      : [await exportImage(doc.pages[0], rects[0]), `${base}-redacted.png`];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    setStatus(null);
    state.busy = false;
    downloadBtn.disabled = false;
  }
});

syncControls();
