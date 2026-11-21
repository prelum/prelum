// Renders examples/*.md to PDFs next to them, plus PNG previews of their first pages for the
// README. Run after changing a theme: npm run examples
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdf } from 'pdf-to-img';
import { render } from '../src/render.ts';

const EXAMPLES = new URL('../examples/', import.meta.url);
const PREVIEWS = new URL('../assets/examples/', import.meta.url);
const PREVIEW_PAGES = 2;
const PREVIEW_SCALE = 1.5;
// A fixed date keeps the committed PDFs byte-identical until the output really changes.
const CREATION_DATE = new Date('2026-11-17T00:00:00Z');

const files = (await readdir(EXAMPLES)).filter((file) => file.endsWith('.md')).sort();

for (const file of files) {
  const name = basename(file, '.md');
  const markdown = await readFile(new URL(file, EXAMPLES), 'utf8');
  const result = await render(markdown, {
    baseDir: fileURLToPath(EXAMPLES),
    creationDate: CREATION_DATE,
  });
  await writeFile(new URL(`${name}.pdf`, EXAMPLES), result.pdf);

  const document = await pdf(Buffer.from(result.pdf), { scale: PREVIEW_SCALE });
  const pages = Math.min(PREVIEW_PAGES, document.length);
  for (let page = 1; page <= pages; page++) {
    await writeFile(new URL(`${name}-${page}.png`, PREVIEWS), await document.getPage(page));
  }

  console.log(
    `  ■ ${name}.pdf  ${result.theme}, ${plural(result.pages, 'page')}, ${plural(pages, 'preview')}`,
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
