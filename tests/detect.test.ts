import { describe, expect, it } from 'vitest';
import { abaValid, Category, detect, luhnValid, spanRects, PageText } from '../src/detect';

const ALL: Category[] = ['ssn', 'card', 'routing', 'account', 'idnum', 'dob', 'email', 'phone', 'address', 'amount', 'custom'];
const run = (text: string, cats: Category[] = ALL, keepLast4 = false, customTerms: string[] = []) =>
  detect(text, { categories: new Set(cats), keepLast4, customTerms });
const found = (text: string, cat: Category, keepLast4 = false) =>
  run(text, ALL, keepLast4).filter(m => m.category === cat).map(m => m.text);

describe('checksums', () => {
  it('luhn', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });
  it('aba', () => {
    expect(abaValid('021000021')).toBe(true); // JPMorgan Chase NY
    expect(abaValid('011000015')).toBe(true); // Federal Reserve Boston
    expect(abaValid('123456789')).toBe(false);
  });
});

describe('detectors', () => {
  it('SSNs, plain and labelled', () => {
    expect(found('SSN: 123-45-6789', 'ssn')).toEqual(['123-45-6789']);
    expect(found('Social Security Number 123456789', 'ssn')).toEqual(['123456789']);
    expect(found('Ref 000-12-3456', 'ssn')).toEqual([]);
  });

  it('card numbers need a valid Luhn checksum', () => {
    expect(found('Card 4111 1111 1111 1111 exp', 'card')).toEqual(['4111 1111 1111 1111']);
    expect(found('Card 4111 1111 1111 1112 exp', 'card')).toEqual([]);
  });

  it('routing numbers labelled or by checksum', () => {
    expect(found('Routing Number: 123456780', 'routing')).toEqual(['123456780']);
    expect(found('wire to 021000021 today', 'routing')).toEqual(['021000021']);
  });

  it('account numbers, keeping the last 4 when asked', () => {
    expect(found('Account Number: 9876543210', 'account')).toEqual(['9876543210']);
    expect(found('Account Number: 9876543210', 'account', true)).toEqual(['987654']);
    expect(found('Account ending in 4321', 'account', true)).toEqual([]);
    expect(found('Acct # XXXX-XXXX-1234', 'account', true)).toEqual([]);
  });

  it('dates of birth only when labelled', () => {
    expect(found('DOB: 04/12/1990', 'dob')).toEqual(['04/12/1990']);
    expect(found('Date of Birth March 3, 1985', 'dob')).toEqual(['March 3, 1985']);
    expect(found('Statement date 04/12/2026', 'dob')).toEqual([]);
  });

  it('contact details', () => {
    expect(found('mail jane.doe+x@example.com now', 'email')).toEqual(['jane.doe+x@example.com']);
    expect(found('Call (555) 123-4567 or 555.987.6543', 'phone')).toEqual(['(555) 123-4567', '555.987.6543']);
  });

  it('addresses', () => {
    expect(found('Lives at 1234 Maple Grove Ave, Apt 5B now', 'address')).toEqual(['1234 Maple Grove Ave, Apt 5B']);
    expect(found('Springfield, IL 62704', 'address')).toEqual(['Springfield, IL 62704']);
    expect(found('springfield, IL 62704', 'address')).toEqual(['springfield, IL 62704']);
    expect(found('New York NY 10001-1234', 'address')).toEqual(['New York NY 10001-1234']);
    expect(found('Invoice total, XQ 12345', 'address')).toEqual([]);
    expect(found('PO Box 991', 'address')).toEqual(['PO Box 991']);
  });

  it('amounts', () => {
    expect(found('Balance $1,234.56 and 89.10 fee', 'amount')).toEqual(['$1,234.56', '89.10']);
  });

  it('ID numbers', () => {
    expect(found("Driver's License: D1234567", 'idnum')).toEqual(['D1234567']);
    expect(found('License Agreement', 'idnum')).toEqual([]);
  });

  it('custom terms are whole-word and case-insensitive', () => {
    const m = run('JANE DOE and Jane  Doe but not janedoe', ['custom'], false, ['Jane Doe']);
    expect(m.map(x => x.text)).toEqual(['JANE DOE', 'Jane  Doe']);
  });

  it('a number is claimed by only one numeric category', () => {
    const m = run('Routing 021000021', ALL);
    expect(m.map(x => x.category)).toEqual(['routing']);
  });

  it('SSN is not mistaken for a phone number', () => {
    expect(run('123-45-6789').map(m => m.category)).toEqual(['ssn']);
  });
});

describe('spanRects', () => {
  it('merges characters on a line and splits across lines', () => {
    const page: PageText = {
      text: 'ab\ncd',
      boxes: [
        { x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, null,
        { x: 0, y: 20, w: 10, h: 10 }, { x: 10, y: 20, w: 10, h: 10 },
      ],
    };
    expect(spanRects(page, 0, 5, 0)).toEqual([{ x: 0, y: 0, w: 20, h: 10 }, { x: 0, y: 20, w: 20, h: 10 }]);
  });
});
