import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildHtml, render } from '../src/render.ts';
import { ThemeNotFoundError } from '../src/themes.ts';

const doc = (frontmatter: string, body = '# Feasibility study\n\nBody.') =>
  `---\n${frontmatter}\n---\n\n${body}`;

const count = (text: string, part: string) => text.split(part).length - 1;

describe('buildHtml', () => {
  it('defaults to report, A4, English, no cover', async () => {
    const result = await buildHtml('Hello.');
    expect(result).toMatchObject({ theme: 'report', format: 'A4', cover: false });
    expect(result.html).toContain('@page { size: A4; }');
    expect(result.html).toContain('--prelum-page: "Page"');
    expect(result.html).not.toContain('prelum-cover"');
  });

  it('lets options win over the frontmatter, and the frontmatter over defaults', async () => {
    const md = doc('theme: technical\nlang: pt');
    expect(await buildHtml(md)).toMatchObject({ theme: 'technical' });
    expect(await buildHtml(md, { theme: 'report' })).toMatchObject({ theme: 'report' });
    expect((await buildHtml(md)).html).toContain('--prelum-page: "Página"');
    expect((await buildHtml(md, { lang: 'en' })).html).toContain('--prelum-page: "Page"');
  });

  it('prints the title once when the cover already shows it', async () => {
    const { html } = await buildHtml(doc('title: Feasibility study\ncover: true'));
    expect(count(html, '<h1')).toBe(1);
    expect(html).toContain('class="prelum-cover"');
  });

  it('keeps an opening heading that differs from the cover title', async () => {
    const { html } = await buildHtml(doc('title: Another title\ncover: true'));
    expect(count(html, '<h1')).toBe(2);
  });

  it('keeps the opening heading when there is no cover', async () => {
    const { html } = await buildHtml(doc('title: Feasibility study'));
    expect(html).toContain('<h1 id="feasibility-study">Feasibility study</h1>');
  });

  it('falls back to the first heading for the header title', async () => {
    const { html } = await buildHtml('# From the heading\n\nBody.');
    expect(html).toContain('--prelum-title: "From the heading"');
  });

  it('sizes the page and the cover for Letter', async () => {
    const { html } = await buildHtml('Hi.', { format: 'Letter' });
    expect(html).toContain('@page { size: Letter; }');
    expect(html).toContain('--page-height: 279.4mm');
  });

  it('escapes the title inside CSS', async () => {
    const { html } = await buildHtml(doc('title: Say "hi"'));
    expect(html).toContain('--prelum-title: "Say \\"hi\\""');
  });

  it('rejects an unknown theme', async () => {
    await expect(buildHtml('Hi.', { theme: 'nope' })).rejects.toBeInstanceOf(ThemeNotFoundError);
  });
});

// These open a real browser (Chrome, Edge or the Playwright cache).
describe('render', () => {
  it('prints a PDF with a cover and reports missing images', { timeout: 30_000 }, async () => {
    const md = doc(
      'title: Smoke test\ncover: true',
      '# Smoke test\n\n![Missing](nope.png)\n\n```mermaid\nflowchart LR\n  A --> B\n```',
    );
    const result = await render(md, { baseDir: tmpdir() });

    expect(Buffer.from(result.pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(result.pages).toBe(2);
    expect(result.diagrams).toBe(1);
    expect(result.warnings).toEqual([{ kind: 'missing-image', src: 'nope.png' }]);
  });

  it('reports a broken diagram instead of failing', { timeout: 30_000 }, async () => {
    const result = await render('```mermaid\nthis is not a diagram\n```');

    expect(result.pages).toBe(1);
    expect(result.warnings).toMatchObject([{ kind: 'diagram-error' }]);
  });
});
