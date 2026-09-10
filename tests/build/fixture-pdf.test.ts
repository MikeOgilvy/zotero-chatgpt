import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const fixture = pathToFileURL(path.resolve(import.meta.dirname, '../fixtures/create-pdf.mjs')).href;

describe('synthetic reading fixture', () => {
  it('keeps selectable text at the bottom of each page for edge-bar acceptance', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { createFixturePdf } from ${JSON.stringify(fixture)};
       const pdf = createFixturePdf().toString('latin1');
       console.log(JSON.stringify({
         footer: pdf.includes('Bottom-edge selection line: keep More details and Ask inside the view.'),
         matrix: /1 0 0 1 48 48 Tm/.test(pdf),
       }));`,
    ]);
    expect(JSON.parse(stdout)).toEqual({ footer: true, matrix: true });
  });
});
