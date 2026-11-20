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

  it('passes raw HTML through', async () => {
    const { html } = await markdownToHtml('<div class="page-break"></div>');
    expect(html).toContain('<div class="page-break"></div>');
  });
});
