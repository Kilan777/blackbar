// Finds sensitive spans in page text. Pure functions — no DOM — so they're unit-testable.

export interface Rect { x: number; y: number; w: number; h: number }

/** Text of one page plus a box for every character (null for synthetic spaces/newlines). */
export interface PageText { text: string; boxes: (Rect | null)[] }

export type Category =
  | 'ssn' | 'card' | 'routing' | 'account' | 'idnum' | 'dob'
  | 'email' | 'phone' | 'address' | 'amount' | 'custom';

export interface Match { category: Category; start: number; end: number; text: string }

export interface DetectOptions {
  categories: Set<Category>;
  /** Leave the last 4 digits of card/account numbers visible. */
  keepLast4: boolean;
  customTerms: string[];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  ssn: 'Social Security numbers',
  card: 'Card numbers',
  routing: 'Routing numbers',
  account: 'Account numbers',
  idnum: "ID / license numbers",
  dob: 'Dates of birth',
  email: 'Email addresses',
  phone: 'Phone numbers',
  address: 'Street addresses',
  amount: 'Dollar amounts',
  custom: 'Your custom words',
};

// Lower number wins when two numeric detectors claim the same digits.
const PRIORITY: Record<Category, number> = {
  ssn: 0, card: 1, routing: 2, idnum: 3, dob: 4, account: 5,
  email: 6, phone: 7, address: 8, amount: 9, custom: 10,
};
const NUMERIC = new Set<Category>(['ssn', 'card', 'routing', 'idnum', 'account', 'phone', 'amount']);
const KEEP_TAIL = new Set<Category>(['card', 'account']);

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** ABA routing number checksum plus a valid Federal Reserve prefix. */
export function abaValid(d: string): boolean {
  if (!/^\d{9}$/.test(d)) return false;
  const p = Number(d.slice(0, 2));
  const prefixOk = (p <= 12) || (p >= 21 && p <= 32) || (p >= 61 && p <= 72) || p === 80;
  if (!prefixOk) return false;
  const n = [...d].map(Number);
  const s = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return s % 10 === 0;
}

const STREET_SUFFIXES = [
  'Street', 'St', 'Avenue', 'Ave', 'Road', 'Rd', 'Boulevard', 'Blvd', 'Lane', 'Ln', 'Drive', 'Dr',
  'Court', 'Ct', 'Way', 'Place', 'Pl', 'Terrace', 'Ter', 'Circle', 'Cir', 'Parkway', 'Pkwy',
  'Highway', 'Hwy', 'Loop', 'Trail', 'Trl', 'Square', 'Sq', 'Pike', 'Alley', 'Row',
];
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|PR|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
const SUFFIX_RE = STREET_SUFFIXES.flatMap(s => [s, s.toUpperCase()]).join('|');

type Finder = (text: string) => Array<{ start: number; end: number }>;

/** All matches of a global regex; if it has a capture group, use group 1's span. */
function finder(re: RegExp, accept?: (s: string) => boolean): Finder {
  return text => {
    const out: Array<{ start: number; end: number }> = [];
    for (const m of text.matchAll(re)) {
      const span = m.indices?.[1] ?? m.indices?.[0] ?? [m.index!, m.index! + m[0].length];
      const s = text.slice(span[0], span[1]);
      if (!accept || accept(s)) out.push({ start: span[0], end: span[1] });
    }
    return out;
  };
}

const digitsOf = (s: string) => s.replace(/\D/g, '');

const FINDERS: Record<Exclude<Category, 'custom'>, Finder[]> = {
  ssn: [
    finder(/(?<![\d-])\d{3}[- ]\d{2}[- ]\d{4}(?![\d-])/dg, s => {
      const a = s.slice(0, 3);
      return a !== '000' && a !== '666';
    }),
    finder(/\b(?:SSN|SS#|social\s+security(?:\s+(?:number|no\.?|#))?|ITIN|TIN)\s*[:#]?\s*(\d{9}|\d{3}[- ]\d{2}[- ]\d{4})(?!\d)/dgi),
  ],
  card: [
    finder(/(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/dg, s => {
      const d = digitsOf(s);
      return d.length >= 13 && d.length <= 19 && luhnValid(d);
    }),
  ],
  routing: [
    finder(/\b(?:routing|ABA|RTN|transit)(?:\s*(?:number|num|no\.?|#))?\s*[:#]?\s*(\d{9})(?!\d)/dgi),
    finder(/(?<![\d.,$-])\d{9}(?![\d.,-])/dg, abaValid),
  ],
  account: [
    finder(/\b(?:account|acct|a\/c|member)\.?\s*(?:number|num|no\.?|#)?\s*(?:ending\s+in\s+)?[:#.]?\s*((?:[X*•x]+[\s-]?)*\d[\d -]{2,24}\d)/dgi,
      s => digitsOf(s).length >= 5),
    finder(/(?<![\d.,$/-])\d{8,17}(?![\d.,/-])/dg),
  ],
  idnum: [
    finder(/\b(?:driver'?s?\s+licen[cs]e|DL|licen[cs]e|passport|member\s+ID|customer\s+ID|ID)\s*(?:number|no\.?|#)?\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,18})\b/dgi),
  ],
  dob: [
    finder(/\b(?:DOB|D\.O\.B\.?|date\s+of\s+birth|birth\s?date|born)\s*[:-]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/dgi),
  ],
  email: [finder(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)],
  phone: [
    finder(/(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g),
  ],
  address: [
    finder(new RegExp(
      String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z0-9][A-Za-z0-9.'-]*\s+){0,4}?(?:${SUFFIX_RE})\b\.?` +
      String.raw`(?:,?\s+(?:Apt|APT|Apartment|Unit|UNIT|Suite|STE|Ste|#)\.?\s*[A-Za-z0-9-]+)?`, 'g')),
    // "Springfield, IL 62704": anchored on a real state code + ZIP, so the city words can be any case (OCR).
    finder(new RegExp(String.raw`\b(?:[A-Za-z][A-Za-z.']*[ \t]+){0,3}[A-Za-z][A-Za-z.']*,?[ \t]+(?:${US_STATES})[ \t]+\d{5}(?:-\d{4})?\b`, 'g')),
    finder(/\bP\.?\s?O\.?\s+Box\s+\d+/gi),
  ],
  amount: [
    finder(/-?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?!\d)|(?<![\d.,/$-])\d{1,3}(?:,\d{3})*\.\d{2}(?![\d.])/g),
  ],
};

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function customFinder(terms: string[]): Finder {
  const parts = terms.map(t => t.trim()).filter(t => t.length >= 2).map(t => {
    const body = escapeRe(t).replace(/\s+/g, '\\s+');
    const pre = /^\w/.test(t) ? '\\b' : '';
    const post = /\w$/.test(t) ? '\\b' : '';
    return pre + body + post;
  });
  if (!parts.length) return () => [];
  return finder(new RegExp(parts.join('|'), 'gi'));
}

/** Shrink a card/account span so its last 4 digits stay visible. Returns null if nothing left to hide. */
function trimToKeepLast4(text: string, start: number, end: number): [number, number] | null {
  const digitIdx: number[] = [];
  for (let i = start; i < end; i++) if (/\d/.test(text[i])) digitIdx.push(i);
  if (digitIdx.length <= 4) return null;
  let newEnd = digitIdx[digitIdx.length - 4];
  while (newEnd > start && /[\s-]/.test(text[newEnd - 1])) newEnd--;
  return [start, newEnd];
}

export function detect(text: string, opts: DetectOptions): Match[] {
  const raw: Array<{ category: Category; start: number; end: number }> = [];
  for (const cat of opts.categories) {
    const finders = cat === 'custom' ? [customFinder(opts.customTerms)] : FINDERS[cat];
    for (const f of finders) for (const s of f(text)) raw.push({ category: cat, ...s });
  }

  // Resolve numeric conflicts: e.g. a 9-digit number that's both "routing" and "account".
  raw.sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category] || a.start - b.start);
  const accepted: typeof raw = [];
  for (const m of raw) {
    const dup = accepted.some(a => a.start === m.start && a.end === m.end && a.category === m.category);
    const clash = NUMERIC.has(m.category) && accepted.some(a =>
      NUMERIC.has(a.category) && a.start < m.end && m.start < a.end);
    if (!dup && !clash) accepted.push(m);
  }

  const out: Match[] = [];
  for (const m of accepted) {
    let { start, end } = m;
    if (opts.keepLast4 && KEEP_TAIL.has(m.category)) {
      const t = trimToKeepLast4(text, start, end);
      if (!t) continue;
      [start, end] = t;
    }
    out.push({ category: m.category, start, end, text: text.slice(start, end) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Turn a character span into one rectangle per visual line. */
export function spanRects(page: PageText, start: number, end: number, pad = 2): Rect[] {
  const rects: Rect[] = [];
  let cur: Rect | null = null;
  for (let i = start; i < end; i++) {
    const b = page.boxes[i];
    if (!b) continue;
    const sameLine = cur && Math.abs((b.y + b.h / 2) - (cur.y + cur.h / 2)) < Math.max(b.h, cur.h) / 2
      && b.x >= cur.x - b.h;
    if (cur && sameLine) {
      const x2 = Math.max(cur.x + cur.w, b.x + b.w), y2 = Math.max(cur.y + cur.h, b.y + b.h);
      cur.x = Math.min(cur.x, b.x); cur.y = Math.min(cur.y, b.y);
      cur.w = x2 - cur.x; cur.h = y2 - cur.y;
    } else {
      if (cur) rects.push(cur);
      cur = { ...b };
    }
  }
  if (cur) rects.push(cur);
  return rects.map(r => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }));
}

export const PRESETS: Record<string, { label: string; categories: Category[]; keepLast4: boolean; hint: string }> = {
  application: {
    label: 'Rental or job application',
    categories: ['ssn', 'card', 'routing', 'account', 'idnum', 'dob', 'custom'],
    keepLast4: true,
    hint: 'Hides SSNs, routing numbers and IDs. Keeps the last 4 digits of accounts and leaves income visible so they can still verify you.',
  },
  public: {
    label: 'Sharing publicly (screenshots, posts)',
    categories: ['ssn', 'card', 'routing', 'account', 'idnum', 'dob', 'email', 'phone', 'address', 'custom'],
    keepLast4: false,
    hint: 'Hides everything that identifies you: numbers, contact details and addresses.',
  },
  everything: {
    label: 'Maximum (everything incl. amounts)',
    categories: ['ssn', 'card', 'routing', 'account', 'idnum', 'dob', 'email', 'phone', 'address', 'amount', 'custom'],
    keepLast4: false,
    hint: 'Hides every detector category, including all dollar amounts.',
  },
};
