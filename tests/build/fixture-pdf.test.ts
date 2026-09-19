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
       const unique = [
         ['The prior weights plausible latent states before the synthetic observation arrives.', 'The likelihood scores that observation under each candidate state.', 'Bayes rule combines those terms into a normalized posterior.'],
         ['Posterior uncertainty remains when several states explain the data similarly.', 'A posterior predictive distribution tests consequences against later observations.', 'A mismatch between prediction and observation can expose a faulty likelihood model.'],
       ];
       const live = createFixturePdf('Live core fixture', 'RUN-0123456789abcdef01234567', { pageProse: unique }).toString('latin1');
       console.log(JSON.stringify({
         footer: pdf.includes('Bottom-edge selection line: keep More details and Ask inside the view.'),
         matrix: /1 0 0 1 48 48 Tm/.test(pdf),
         defaultPriorOccurrences: pdf.split('A prior describes beliefs before a measurement is observed.').length - 1,
         liveUniquePassages: unique.flat().filter(sentence => live.split(sentence).length === 2).length,
       }));`,
    ]);
    expect(JSON.parse(stdout)).toEqual({ footer: true, matrix: true, defaultPriorOccurrences: 2, liveUniquePassages: 6 });
  });
});
