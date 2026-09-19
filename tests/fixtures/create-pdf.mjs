// Original, synthetic test material. No real publication or external font assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const escapePdf = (text) => text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');

export function createFixturePdf(title = 'ZCHATGPT synthetic reading fixture', verificationToken = 'ORCHID-72', options = {}) {
  const defaultProse = [
    'A prior describes beliefs before a measurement is observed.',
    'A likelihood describes the measurement under each candidate state.',
    'The posterior combines both quantities and is normalized.',
    '',
    'This paragraph is a stable anchor for sidebar layout tests.',
    'Opening the sidebar should keep the current passage in view.',
    'Closing it must not jump back to a previously visited page.',
    '',
    'The source title and attachment identity are separate values.',
    'Two PDF attachments may belong to the same bibliographic item.',
    'They must keep separate reader contexts.',
  ];
  const streams = [0, 1].map((page) => {
    const lines = [
      title,
      `Synthetic page ${page + 1} - development testing only`,
      page === 1 ? `Hidden verification token on this page: ${verificationToken}.` : 'Calibration constant for this synthetic example: 37.',
      '',
      ...(options.pageProse?.[page] ?? defaultProse),
      '',
      ...Array.from({ length: 14 }, (_, i) => `Anchor line ${page + 1}.${i + 1}: preserve selection and reading position.`),
    ];
    const footer = 'Bottom-edge selection line: keep More details and Ask inside the view.';
    return ['BT', '/F1 13 Tf', '18 TL', '48 790 Td', ...lines.flatMap((line) => [`(${escapePdf(line)}) Tj`, 'T*']), 'ET', 'BT', '/F1 13 Tf', '1 0 0 1 48 48 Tm', `(${escapePdf(footer)}) Tj`, 'ET'].join('\n');
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D /St 1 >>] >> >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map((stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = resolve(process.argv[2] ?? '.zotero-chatgpt-dev/fixtures/reading.pdf');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, createFixturePdf());
  console.log(outputPath);
}
