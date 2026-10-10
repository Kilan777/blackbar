// Generates fake test documents (all data is made up / standard test numbers).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const dir = new URL('./fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

export const FAKE = {
  name: 'Jane Example',
  ssn: '123-45-6789',
  account: '9876543210',
  routing: '021000021',
  card: '4111 1111 1111 1111',
  email: 'jane.example@example.com',
  phone: '(555) 201-7788',
  street: '1234 Maple Grove Ave, Apt 5B',
  city: 'Springfield, IL 62704',
  dob: '04/12/1990',
};

export const LINES = [
  ['First Example Bank', 20],
  ['Monthly Statement   Period: 09/01/2026 - 09/30/2026', 11],
  ['', 11],
  [FAKE.name, 12],
  [FAKE.street, 12],
  [FAKE.city, 12],
  [`Email: ${FAKE.email}    Phone: ${FAKE.phone}`, 11],
  ['', 11],
  [`Account Number: ${FAKE.account}`, 12],
  [`Routing Number: ${FAKE.routing}`, 12],
  [`Debit Card: ${FAKE.card}`, 12],
  [`SSN: ${FAKE.ssn}     Date of Birth: ${FAKE.dob}`, 12],
  ['', 11],
  ['Date        Description                        Amount        Balance', 11],
  ['09/01       Opening balance                                  $2,410.33', 11],
  ['09/03       Payroll - Example Widgets Inc       $1,850.00    $4,260.33', 11],
  ['09/05       Rent payment                       -$1,200.00    $3,060.33', 11],
  ['09/12       Grocery Store #221                    -84.17     $2,976.16', 11],
  ['09/30       Closing balance                                  $2,976.16', 11],
];

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Courier);
const bold = await pdf.embedFont(StandardFonts.CourierBold);
const page = pdf.addPage([612, 792]);
let y = 740;
for (const [text, size] of LINES) {
  if (text) page.drawText(text, { x: 50, y, size, font: size > 12 ? bold : font, color: rgb(0.1, 0.1, 0.1) });
  y -= size + 9;
}
pdf.setTitle('Statement for Jane Example');
pdf.setAuthor('Jane Example');
writeFileSync(new URL('statement.pdf', dir), await pdf.save());
console.log('wrote e2e/fixtures/statement.pdf');

// A "scanned" PDF: just an image of the statement, no text layer. Needs statement.png (made with pdftoppm).
const png = new URL('statement.png', dir);
if (existsSync(png)) {
  const scan = await PDFDocument.create();
  const img = await scan.embedPng(readFileSync(png));
  scan.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  writeFileSync(new URL('scanned.pdf', dir), await scan.save());
  console.log('wrote e2e/fixtures/scanned.pdf');
}
