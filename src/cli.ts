#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { YAMLParseError } from 'yaml';
import { BrowserNotFoundError } from './browser.ts';
import { colorDepth, type Palette, palette } from './colors.ts';
import { detectLang, type Messages, messages } from './i18n.ts';
import type { Lang } from './markdown.ts';
import { type PaperFormat, type RenderResult, render } from './render.ts';
import { DEFAULT_THEME, listThemes, ThemeNotFoundError } from './themes.ts';

const EXIT = { ok: 0, input: 1, render: 2, browser: 3 } as const;
type ExitCode = (typeof EXIT)[keyof typeof EXIT];

// `../package.json` resolves the same from src/ (dev) and dist/ (published).
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const out = (text = '') => process.stdout.write(`${text}\n`);
const paint = palette(colorDepth(process.stdout, process.env));
const paintErr = palette(colorDepth(process.stderr, process.env));

type Settings = {
  t: Messages;
  lang: Lang;
  theme: string | undefined;
  cover: boolean | undefined;
  format: PaperFormat;
  css: string | undefined;
  out: string | undefined;
  html: boolean;
};

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<ExitCode> {
  let lang = detectLang(env);
  let t = messages(lang);

  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (error) {
    return fail(t.badOption(firstLine(error)), EXIT.input);
  }
  const { values, positionals } = args;

  if (values.lang !== undefined) {
    if (values.lang !== 'en' && values.lang !== 'pt') {
      return fail(t.badValue('--lang', values.lang, ['en', 'pt']), EXIT.input);
    }
    lang = values.lang;
    t = messages(lang);
  }

  if (values.version) {
    out(version);
    return EXIT.ok;
  }
  if (values.help) {
    out(t.help(version).replace('■', paint.error('■')));
    return EXIT.ok;
  }
  if (positionals.length === 1 && positionals[0] === 'themes') {
    out();
    for (const theme of await listThemes()) {
      out(`  ${theme.padEnd(12)}${theme === DEFAULT_THEME ? paint.dim(t.themesDefault) : ''}`);
    }
    out();
    return EXIT.ok;
  }
  if (positionals.length === 0) {
    fail(t.noInput(), EXIT.input);
    out(t.help(version).replace('■', paint.error('■')));
    return EXIT.input;
  }

  const format = paperFormat(values.format ?? 'A4');
  if (!format)
    return fail(t.badValue('--format', values.format ?? '', ['A4', 'Letter']), EXIT.input);
  if (positionals.length > 1 && values.out?.toLowerCase().endsWith('.pdf')) {
    return fail(t.outMustBeFolder(), EXIT.input);
  }

  let css: string | undefined;
  if (values.css !== undefined) {
    try {
      css = await readFile(values.css, 'utf8');
    } catch {
      return fail(t.cssNotFound(values.css), EXIT.input);
    }
  }

  const settings: Settings = {
    t,
    lang,
    theme: values.theme,
    cover: values.cover,
    format,
    css,
    out: values.out,
    html: values.html ?? false,
  };

  out();
  out(`  prelum${paint.error('■')} ${version}`);
  let worst: ExitCode = EXIT.ok;
  for (const file of positionals) {
    const code = await convert(file, settings);
    if (code > worst) worst = code;
    if (code === EXIT.browser) break; // no point trying the next files
  }
  return worst;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true, // --no-cover
    options: {
      theme: { type: 'string', short: 't' },
      out: { type: 'string', short: 'o' },
      format: { type: 'string' },
      cover: { type: 'boolean' },
      css: { type: 'string' },
      html: { type: 'boolean' },
      lang: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}

async function convert(file: string, s: Settings): Promise<ExitCode> {
  const { t } = s;
  let markdown: string;
  try {
    markdown = await readFile(file, 'utf8');
  } catch {
    return fail(t.fileNotFound(file), EXIT.input);
  }

  let result: RenderResult;
  try {
    result = await render(markdown, {
      theme: s.theme,
      cover: s.cover,
      format: s.format,
      css: s.css,
      baseDir: dirname(resolve(file)),
      defaultLang: s.lang,
    });
  } catch (error) {
    if (error instanceof ThemeNotFoundError) {
      return fail(t.themeNotFound(error.theme, error.available, error.suggestion), EXIT.input);
    }
    if (error instanceof YAMLParseError) {
      return fail(t.badFrontmatter(file, firstLine(error)), EXIT.input);
    }
    if (error instanceof BrowserNotFoundError) return fail(t.browserMissing(), EXIT.browser);
    return fail(t.renderFailed(file, firstLine(error)), EXIT.render);
  }

  const target = outputPath(file, s.out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, result.pdf);
  const htmlTarget = target.replace(/\.pdf$/i, '.html');
  if (s.html) await writeFile(htmlTarget, result.html);

  const row = (mark: string, label: string, text: string) =>
    out(`  ${mark} ${paint.dim(label.padEnd(12))}${text}`);
  const ok = paint.ok('✓');
  const warn = paint.warn('!');

  out();
  row(ok, t.label.markdown, t.words(result.words));
  if (result.diagrams > 0) row(ok, t.label.mermaid, t.diagrams(result.diagrams));
  for (const warning of result.warnings) {
    if (warning.kind === 'missing-image') row(warn, t.label.image, t.missingImage(warning.src));
    else row(warn, t.label.mermaid, t.diagramError(firstLine(warning.message)));
  }
  row(ok, t.label.theme, result.theme);
  row(ok, t.label.pages, t.pages(result.pages, result.cover));
  if (s.html) row(ok, t.label.html, display(htmlTarget));
  out();
  out(`  ${paint.error('■')} ${t.ready(display(target), result.ms)}`);
  out();
  return EXIT.ok;
}

/** report.md → report.pdf next to it; `--out x.pdf` is a file; any other `--out` is a folder. */
function outputPath(file: string, out: string | undefined): string {
  const name = `${basename(file, extname(file))}.pdf`;
  if (out === undefined) return join(dirname(file), name);
  return out.toLowerCase().endsWith('.pdf') ? out : join(out, name);
}

function paperFormat(value: string): PaperFormat | undefined {
  const lower = value.toLowerCase();
  return lower === 'a4' ? 'A4' : lower === 'letter' ? 'Letter' : undefined;
}

/** Errors say what went wrong on the first line and what to do on the next ones. */
function fail(lines: string[], code: ExitCode, p: Palette = paintErr): ExitCode {
  const [headline, ...hints] = lines;
  process.stderr.write(`\n  ${p.error('✗')} ${headline}\n`);
  for (const hint of hints) process.stderr.write(`    ${p.dim(hint)}\n`);
  process.stderr.write('\n');
  return code;
}

/** The shorter of the relative and absolute paths: "out/a.pdf", but "/tmp/a.pdf" over "../../../tmp/a.pdf". */
function display(path: string): string {
  const absolute = resolve(path);
  const fromHere = relative(process.cwd(), absolute);
  return fromHere && fromHere.length < absolute.length ? fromHere : absolute;
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';

process.exitCode = await main(process.argv.slice(2), process.env);
