import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from 'playwright-core';
import { launchBrowser } from './browser.ts';
import { coverHtml } from './cover.ts';
import { cssString, escapeHtml } from './escape.ts';
import { type Lang, markdownToHtml } from './markdown.ts';
import { DEFAULT_THEME, loadTheme } from './themes.ts';

export type PaperFormat = 'A4' | 'Letter';

export type RenderOptions = {
  /** Wins over the frontmatter `theme`. */
  theme?: string;
  /** Wins over the frontmatter `cover`. */
  cover?: boolean;
  /** Language of the text Prelum adds to the PDF ("Page 2 of 4"). Wins over the frontmatter. */
  lang?: Lang;
  format?: PaperFormat;
  /** Extra CSS after the theme: the advanced escape hatch. */
  css?: string;
  /** Folder that relative image paths resolve against. Defaults to the current folder. */
  baseDir?: string;
};

export type Warning =
  | { kind: 'missing-image'; src: string }
  | { kind: 'diagram-error'; message: string };

export type Document = {
  html: string;
  theme: string;
  cover: boolean;
  format: PaperFormat;
  words: number;
  diagrams: number;
};

export type RenderResult = Omit<Document, 'html'> & {
  pdf: Uint8Array;
  pages: number;
  browser: string;
  warnings: Warning[];
  ms: number;
};

const MERMAID_JS = fileURLToPath(new URL('../vendor/mermaid.min.js', import.meta.url));
const PAGE_HEIGHT: Record<PaperFormat, string> = { A4: '297mm', Letter: '279.4mm' };
const PAGE_LABEL: Record<Lang, [page: string, of: string]> = {
  en: ['Page', 'of'],
  pt: ['Página', 'de'],
};

export async function render(markdown: string, options: RenderOptions = {}): Promise<RenderResult> {
  const started = performance.now();
  const { html, ...doc } = await buildHtml(markdown, options);

  const dir = await mkdtemp(join(tmpdir(), 'prelum-'));
  const { browser, label } = await launchBrowser();
  try {
    // A real file, not setContent: an about:blank page may not load file:// images.
    const htmlPath = join(dir, 'document.html');
    await writeFile(htmlPath, html);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

    const warnings: Warning[] = (await missingImages(page)).map((src) => ({
      kind: 'missing-image',
      src,
    }));
    if (doc.diagrams > 0) {
      const error = await drawDiagrams(page);
      if (error) warnings.push({ kind: 'diagram-error', message: error });
    }
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    return {
      ...doc,
      pdf,
      pages: countPages(pdf),
      browser: label,
      warnings,
      ms: performance.now() - started,
    };
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** Markdown + options → the full HTML page. Pure: no browser involved. */
export async function buildHtml(markdown: string, options: RenderOptions = {}): Promise<Document> {
  const md = await markdownToHtml(markdown);
  const fm = md.frontmatter;

  const theme = options.theme ?? fm.theme ?? DEFAULT_THEME;
  const cover = options.cover ?? fm.cover ?? false;
  const lang = options.lang ?? fm.lang ?? 'en';
  const format = options.format ?? 'A4';
  const title = fm.title ?? md.firstHeading ?? '';
  const themeCss = await loadTheme(theme);

  // With a cover, an opening "# Title" equal to the cover title would print twice.
  const repeatsCover = cover && md.leadingTitle?.text === title;
  const body = (repeatsCover ? '' : (md.leadingTitle?.html ?? '')) + md.html;
  const baseHref = `${pathToFileURL(resolve(options.baseDir ?? '.')).href}/`;

  const html = `<!doctype html>
<html lang="${lang === 'pt' ? 'pt-BR' : 'en'}">
<head>
<meta charset="utf-8">
<base href="${escapeHtml(baseHref)}">
<title>${escapeHtml(title)}</title>
<style>
${themeCss}
${documentCss({ format, lang, title, client: fm.client ?? '' })}
${options.css ?? ''}
</style>
</head>
<body>
${cover ? coverHtml({ ...fm, title }, lang) : ''}
<main>${body}</main>
</body>
</html>`;

  return { html, theme, cover, format, words: md.words, diagrams: md.diagrams };
}

/**
 * What the theme needs from this document. Themes lay out headers and footers in their own
 * @page margin boxes and read the text from these properties.
 */
function documentCss(doc: { format: PaperFormat; lang: Lang; title: string; client: string }) {
  const [page, of] = PAGE_LABEL[doc.lang];
  return `@page { size: ${doc.format}; }
:root {
  --page-height: ${PAGE_HEIGHT[doc.format]};
  --prelum-title: ${cssString(doc.title)};
  --prelum-client: ${cssString(doc.client)};
  --prelum-page: ${cssString(page)};
  --prelum-of: ${cssString(of)};
}`;
}

function missingImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.images]
      .filter((img) => img.naturalWidth === 0)
      .map((img) => img.getAttribute('src') ?? ''),
  );
}

type MermaidApi = {
  initialize(config: object): void;
  run(options: { querySelector: string }): Promise<void>;
};

/** Draws every div.mermaid with the theme colors. Returns the error message, if any. */
async function drawDiagrams(page: Page): Promise<string | undefined> {
  await page.addScriptTag({ path: MERMAID_JS });
  return page.evaluate(async () => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    const fill = read('--diagram-fill', '#ffffff');
    const stroke = read('--diagram-stroke', '#1c1a17');

    const { mermaid } = globalThis as unknown as { mermaid: MermaidApi };
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        fontFamily: read('--sans', 'sans-serif'),
        fontSize: '12px',
        primaryColor: fill,
        secondaryColor: fill,
        tertiaryColor: '#ffffff',
        primaryBorderColor: stroke,
        primaryTextColor: read('--diagram-text', '#1c1a17'),
        lineColor: stroke,
        edgeLabelBackground: '#ffffff',
      },
    });
    try {
      await mermaid.run({ querySelector: 'div.mermaid' });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

/** Chrome writes one `/Type /Page` dictionary per page, uncompressed. */
export function countPages(pdf: Uint8Array): number {
  return (
    Buffer.from(pdf)
      .toString('latin1')
      .match(/\/Type\s*\/Page\b/g) ?? []
  ).length;
}
