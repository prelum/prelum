import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from 'playwright-core';
import { launchBrowser } from './browser.ts';
import { coverHtml } from './cover.ts';
import { cssString, escapeHtml } from './escape.ts';
import { fontFaceCss } from './fonts.ts';
import { type Lang, markdownToHtml } from './markdown.ts';
import { stampMetadata } from './pdf-metadata.ts';
import { DEFAULT_THEME, loadTheme } from './themes.ts';
import { version } from './version.ts';

export type PaperFormat = 'A4' | 'Letter';

export type RenderOptions = {
  /** Wins over the frontmatter `theme`. */
  theme?: string;
  /** Wins over the frontmatter `cover`. */
  cover?: boolean;
  /** Language of the text Prelum adds to the PDF ("Page 2 of 4"). Wins over the frontmatter. */
  lang?: Lang;
  /** Used only when neither `lang` nor the frontmatter say anything (e.g. the terminal's LANG). */
  defaultLang?: Lang;
  format?: PaperFormat;
  /** Extra CSS after the theme: the advanced escape hatch. */
  css?: string;
  /** Folder that relative image paths resolve against. Defaults to the current folder. */
  baseDir?: string;
  /** Date stamped in the PDF metadata. Defaults to now; fix it for reproducible output. */
  creationDate?: Date;
  /** Print only with the Chromium build playwright-core expects, for the same bytes on any machine. */
  pinnedBrowser?: boolean;
};

export type Warning =
  | { kind: 'missing-image'; src: string }
  | { kind: 'diagram-error'; message: string }
  /** `diagram` counts from 1; `scale` is the printed width over the natural one (0.55 = 55%). */
  | { kind: 'diagram-scaled'; diagram: number; scale: number };

export type Document = {
  html: string;
  theme: string;
  cover: boolean;
  format: PaperFormat;
  words: number;
  diagrams: number;
};

export type RenderResult = Document & {
  pdf: Uint8Array;
  pages: number;
  /** "Chrome 151.0.7922.34": also recorded in the PDF's /Creator. */
  browser: string;
  warnings: Warning[];
  ms: number;
};

const MERMAID_JS = fileURLToPath(new URL('../vendor/mermaid.min.js', import.meta.url));
const PAGE_MM: Record<PaperFormat, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
};
const PAGE_HEIGHT: Record<PaperFormat, string> = {
  A4: `${PAGE_MM.A4.height}mm`,
  Letter: `${PAGE_MM.Letter.height}mm`,
};
// The words Prelum adds to the document itself.
const LABELS: Record<Lang, { page: string; of: string; figure: string }> = {
  en: { page: 'Page', of: 'of', figure: 'Figure' },
  pt: { page: 'Página', of: 'de', figure: 'Figura' },
};

export async function render(markdown: string, options: RenderOptions = {}): Promise<RenderResult> {
  const started = performance.now();
  const doc = await buildHtml(markdown, options);

  const dir = await mkdtemp(join(tmpdir(), 'prelum-'));
  const { browser, description } = await launchBrowser({ pinned: options.pinnedBrowser });
  try {
    // A real file, not setContent: an about:blank page may not load file:// images.
    const htmlPath = join(dir, 'document.html');
    await writeFile(htmlPath, doc.html);
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

    const warnings: Warning[] = (await missingImages(page)).map((src) => ({
      kind: 'missing-image',
      src,
    }));
    // Fonts first: Mermaid sizes its boxes by measuring text, so it must measure the real font.
    await page.evaluate(() => document.fonts.ready);
    if (doc.diagrams > 0) {
      const error = await drawDiagrams(page);
      if (error) warnings.push({ kind: 'diagram-error', message: error });
    }
    await page.evaluate(() => document.fonts.ready);

    // From here on the page is laid out at the printed text width, so measurements match the PDF.
    const contentHeightMm = await usePrintLayout(page, doc.format);
    if (contentHeightMm !== undefined) {
      if (doc.diagrams > 0) warnings.push(...(await scaledDiagrams(page)));
      await fitFigures(page, contentHeightMm);
    }

    const printed = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      // Bookmarks from the headings (the side panel in PDF readers), and a tagged, accessible PDF.
      outline: true,
      tagged: true,
    });
    const pdf = stampMetadata(printed, options.creationDate, `prelum ${version} · ${description}`);
    return {
      ...doc,
      pdf,
      pages: countPages(pdf),
      browser: description,
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
  const lang = options.lang ?? fm.lang ?? options.defaultLang ?? 'en';
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
${fontFaceCss()}
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
  const labels = LABELS[doc.lang];
  const header = fitHeader(doc.client, doc.title);
  return `@page { size: ${doc.format}; }
:root {
  --page-height: ${PAGE_HEIGHT[doc.format]};
  --prelum-title: ${cssString(doc.title)};
  --prelum-client: ${cssString(doc.client)};
  --prelum-header-title: ${cssString(header.title)};
  --prelum-header-client: ${cssString(header.client)};
  --prelum-page: ${cssString(labels.page)};
  --prelum-of: ${cssString(labels.of)};
  --prelum-figure: ${cssString(labels.figure)};
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
    const font = read('--sans', 'sans-serif');
    // Fonts load on first use, and the page may not have used this one yet.
    await document.fonts.load(`12px ${font}`);

    const { mermaid } = globalThis as unknown as { mermaid: MermaidApi };
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        fontFamily: font,
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

/**
 * Client and title for a one-line header. Chrome ignores overflow and ellipsis in @page margin
 * boxes, so long texts would wrap onto two lines (or overlap): they are shortened here instead.
 * About 70 characters fit on the line; the longer side gives way first, down to a readable
 * minimum. The full title still goes on the cover, in the bookmarks and in the metadata.
 */
export function fitHeader(
  client: string,
  title: string,
  room = 70,
): { client: string; title: string } {
  if (client.length + title.length <= room) return { client, title };
  const clientRoom = Math.min(client.length, Math.max(30, room - title.length));
  const titleRoom = Math.min(title.length, Math.max(40, room - clientRoom));
  return { client: shorten(client, clientRoom), title: shorten(title, titleRoom) };
}

function shorten(text: string, room: number): string {
  if (text.length <= room) return text;
  // Cut at a word boundary when one is close, and never leave a dangling separator.
  const cut = text.slice(0, room - 1);
  const space = cut.lastIndexOf(' ');
  const base = space > room * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s·,;:—–-]+$/u, '')}…`;
}

/** Figures never shrink below this, nor below this share of their own height. */
const FIT_MIN_MM = 55;
const FIT_MIN_SHARE = 0.5;
/** A heading needs this much room after it, or it moves to the next page with its text. */
const KEEP_WITH_NEXT_MM = 12;

/**
 * A figure never splits across pages, so one that does not fit at the bottom of a page moves
 * whole to the next and leaves a gap. This lays the page out at the printed width and walks the
 * blocks as print would, page by page: blocks that do not split (list items, code, diagrams,
 * quotes) and headings that would sit alone at the bottom move to the next page. When a figure
 * does not fit and the room left holds at least half of it (and the readable minimum), the
 * figure shrinks to fit; otherwise it moves too. The spacers only serve the measurement and are
 * removed. Breaks are never forced: if the simulation is off, the result is the plain layout.
 */
/**
 * Print media and a viewport as wide as the page's text column, so the layout in the window is
 * the one the PDF will get. Returns the text height of a page in mm, or undefined (and changes
 * nothing) when the theme's margins cannot be read.
 */
async function usePrintLayout(page: Page, format: PaperFormat): Promise<number | undefined> {
  // The theme decides the margins: read them from its @page rule.
  const margins = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSPageRule && rule.selectorText === '' && rule.style.marginTop) {
          const { marginTop, marginRight, marginBottom, marginLeft } = rule.style;
          return [marginTop, marginRight, marginBottom, marginLeft];
        }
      }
    }
    return undefined;
  });
  const mm = margins?.map((value) =>
    value.endsWith('mm') ? Number.parseFloat(value) : Number.NaN,
  );
  if (!mm || mm.some(Number.isNaN)) return undefined; // margins we cannot read: keep the plain layout
  const [top = 0, right = 0, bottom = 0, left = 0] = mm;

  const size = PAGE_MM[format];
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({
    width: Math.round(((size.width - left - right) * 96) / 25.4),
    height: 1000,
  });
  return size.height - top - bottom;
}

/**
 * Diagrams wider than the text column are scaled down, text included. Below this share of their
 * natural width, the 12px labels drop under ~9.5px: still printed, but worth a warning.
 */
const MIN_DIAGRAM_SCALE = 0.8;

/** Compares each diagram's printed width with its natural width (the SVG viewBox). */
async function scaledDiagrams(page: Page): Promise<Warning[]> {
  const scales = await page.evaluate(() =>
    [...document.querySelectorAll('div.mermaid')].map((div) => {
      const svg = div.querySelector('svg');
      // A broken diagram becomes Mermaid's error graphic: already reported, not measured.
      if (!svg || svg.getAttribute('aria-roledescription') === 'error') return 1;
      const natural = svg.viewBox.baseVal?.width;
      return natural ? svg.getBoundingClientRect().width / natural : 1;
    }),
  );
  return scales.flatMap((scale, index) =>
    scale < MIN_DIAGRAM_SCALE
      ? [{ kind: 'diagram-scaled' as const, diagram: index + 1, scale }]
      : [],
  );
}

/** Needs the print layout (`usePrintLayout`). */
async function fitFigures(page: Page, contentMm: number): Promise<void> {
  if (!(await page.evaluate(() => document.querySelector('figure img') !== null))) return;

  await page.evaluate(
    ({ contentMm, minMm, minShare, keepMm }) => {
      const pxPerMm = 96 / 25.4;
      const pageHeight = contentMm * pxPerMm;
      const UNITS = 'h1, h2, h3, h4, p, li, figure, div.mermaid, pre, blockquote, table';
      const main = document.querySelector('main');
      if (!main) return;
      const origin = main.getBoundingClientRect().top + window.scrollY;
      const units = [...main.querySelectorAll<HTMLElement>(UNITS)].filter(
        (el) => !el.parentElement?.closest(UNITS) || el.matches('li'),
      );
      const spacers: HTMLElement[] = [];
      const pushToNextPage = (el: HTMLElement, at: number, pageEnd: number) => {
        const spacer = document.createElement('div');
        spacer.style.height = `${pageEnd - at}px`;
        el.before(spacer);
        spacers.push(spacer);
      };

      for (const el of units) {
        const box = el.getBoundingClientRect();
        const at = box.top + window.scrollY - origin;
        const end = at + box.height;
        const pageEnd = Math.ceil((at + 1) / pageHeight) * pageHeight;

        if (el.matches('h1, h2, h3, h4')) {
          if (end + keepMm * pxPerMm > pageEnd) pushToNextPage(el, at, pageEnd);
          continue;
        }
        // Fits, cannot fit any page anyway, or splits across pages on its own.
        if (end <= pageEnd || box.height >= pageHeight || el.matches('p, table')) continue;

        const img = el.matches('figure') ? el.querySelector('img') : null;
        if (img) {
          const imgHeight = img.getBoundingClientRect().height;
          const room = pageEnd - at - (box.height - imgHeight) - 6;
          if (room >= Math.max(minMm * pxPerMm, imgHeight * minShare)) {
            img.style.maxHeight = `${room}px`;
            continue;
          }
        }
        pushToNextPage(el, at, pageEnd);
      }
      for (const spacer of spacers) spacer.remove();
    },
    {
      contentMm,
      minMm: FIT_MIN_MM,
      minShare: FIT_MIN_SHARE,
      keepMm: KEEP_WITH_NEXT_MM,
    },
  );
}
