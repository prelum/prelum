import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../src/markdown.ts';

describe('markdownToHtml', () => {
  it('reads known frontmatter fields and ignores unknown ones', async () => {
    const md = [
      '---',
      'title: Feasibility study',
      'date: 2026-11-17',
      'cover: true',
      'lang: pt-BR',
      'favorite_color: red',
      '---',
      '',
      'Body.',
    ].join('\n');

    const { frontmatter } = await markdownToHtml(md);

    // The date stays a string: no Date object, no timezone surprises.
    expect(frontmatter).toEqual({
      title: 'Feasibility study',
      date: '2026-11-17',
      cover: true,
      lang: 'pt',
    });
  });

  it('ignores fields with the wrong type', async () => {
    const { frontmatter } = await markdownToHtml('---\ncover: "yes"\ntitle: [a, b]\n---\n');
    expect(frontmatter).toEqual({});
  });

  it('works without frontmatter', async () => {
    const { frontmatter, html } = await markdownToHtml('Just text.');
    expect(frontmatter).toEqual({});
    expect(html.trim()).toBe('<p>Just text.</p>');
  });

  it('turns mermaid fences into div.mermaid and counts them', async () => {
    const md = [
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'pie',
      '```',
      '',
      '```js',
      'x()',
      '```',
    ].join('\n');
    const { html, diagrams } = await markdownToHtml(md);

    expect(diagrams).toBe(2);
    expect(html.match(/<div class="mermaid">/g)).toHaveLength(2);
    expect(html).toContain('<div class="mermaid">flowchart LR\n  A --> B\n</div>');
    // Not wrapped in <pre>: the theme would paint it as a code block (dark background).
    expect(html).not.toContain('<pre><div');
    expect(html).not.toContain('language-mermaid');
    expect(html).toContain('<code class="language-js">');
  });

  it('keeps GFM table alignment for the theme CSS', async () => {
    const { html } = await markdownToHtml('| Item | Hours |\n|---|--:|\n| Backend | 120 |');
    expect(html).toContain('<td align="right">120</td>');
  });

  it('gives headings GitHub-style ids for internal links', async () => {
    const { html } = await markdownToHtml('## Escopo do projeto');
    expect(html).toContain('<h2 id="escopo-do-projeto">');
  });

  it('counts words and finds the first top-level heading', async () => {
    const md = '## Not this one\n\n# Estudo de viabilidade\n\nO portal reduz **40%** dos chamados.';
    const { firstHeading, words } = await markdownToHtml(md);

    expect(firstHeading).toBe('Estudo de viabilidade');
    expect(words).toBe(3 + 3 + 6);
  });

  it('keeps an opening # heading apart from the body', async () => {
    const md = '---\ntitle: X\n---\n\n# Estudo de *viabilidade*\n\nBody.\n\n# Second';
    const { leadingTitle, html } = await markdownToHtml(md);

    expect(leadingTitle?.text).toBe('Estudo de viabilidade');
    expect(leadingTitle?.html).toBe(
      '<h1 id="estudo-de-viabilidade">Estudo de <em>viabilidade</em></h1>',
    );
    expect(html).not.toContain('Estudo de');
    expect(html).toContain('<h1 id="second">Second</h1>');
  });

  it('has no leading title when the document opens with something else', async () => {
    const { leadingTitle } = await markdownToHtml('Intro.\n\n# Title');
    expect(leadingTitle).toBeUndefined();
  });

  it('turns an image alone in its paragraph into a captioned figure', async () => {
    const { html } = await markdownToHtml('![The panel, overdue invoices first](prints/a.png)');
    expect(html).toBe(
      '<figure><img src="prints/a.png" alt="The panel, overdue invoices first">' +
        '<figcaption>The panel, overdue invoices first</figcaption></figure>',
    );
  });

  it('reads a height in millimetres from the image title', async () => {
    const { html } = await markdownToHtml('![Phone](prints/b.png "90mm")');
    expect(html).toContain('<img src="prints/b.png" alt="Phone" style="max-height: 90mm">');
    expect(html).not.toContain('title=');
  });

  it('keeps any other title as a title', async () => {
    const { html } = await markdownToHtml('![Logo](logo.png "Our logo")');
    expect(html).toContain('title="Our logo"');
    expect(html).not.toContain('style=');
  });

  it('leaves images inside text inline', async () => {
    const { html } = await markdownToHtml('Click ![icon](i.png) to save.');
    expect(html).not.toContain('<figure>');
  });

  it('makes a figure without a caption when there is no alt text', async () => {
    const { html } = await markdownToHtml('![](prints/c.png)');
    expect(html).toContain('<figure><img src="prints/c.png" alt=""></figure>');
  });

  it('passes raw HTML through', async () => {
    const { html } = await markdownToHtml('<div class="page-break"></div>');
    expect(html).toContain('<div class="page-break"></div>');
  });
});
