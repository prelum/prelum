import type { Nodes, Root } from 'mdast';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';

export type Lang = 'en' | 'pt';

export type Frontmatter = {
  title?: string;
  subtitle?: string;
  client?: string;
  author?: string;
  date?: string;
  theme?: string;
  cover?: boolean;
  lang?: Lang;
};

export type MarkdownResult = {
  html: string;
  frontmatter: Frontmatter;
  /** Text of the first `#` heading: the title when the frontmatter has none. */
  firstHeading: string | undefined;
  words: number;
  diagrams: number;
};

type Findings = {
  yaml: string;
  firstHeading: string | undefined;
  words: number;
  diagrams: number;
};

export async function markdownToHtml(markdown: string): Promise<MarkdownResult> {
  const found: Findings = { yaml: '', firstHeading: undefined, words: 0, diagrams: 0 };

  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(() => (tree: Root) => inspect(tree, found))
    // Raw HTML passes through, as it did with pandoc (e.g. a manual page break).
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return {
    html: String(file),
    frontmatter: readFrontmatter(found.yaml),
    firstHeading: found.firstHeading,
    words: found.words,
    diagrams: found.diagrams,
  };
}

// One pass over the markdown tree collects everything the CLI reports
// and turns ```mermaid fences into <div class="mermaid">.
function inspect(tree: Root, found: Findings): void {
  walk(tree, (node) => {
    switch (node.type) {
      case 'yaml':
        found.yaml = node.value;
        break;
      case 'heading':
        if (node.depth === 1 && found.firstHeading === undefined) {
          found.firstHeading = plainText(node);
        }
        break;
      case 'text':
        found.words += node.value.split(/\s+/).filter(Boolean).length;
        break;
      case 'code':
        if (node.lang === 'mermaid') {
          found.diagrams += 1;
          // remark-rehype reads these hints instead of building <pre><code>.
          node.data = {
            hName: 'div',
            hProperties: { className: ['mermaid'] },
            hChildren: [{ type: 'text', value: node.value }],
          };
        }
        break;
    }
  });
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) walk(child, visit);
  }
}

function plainText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return 'children' in node ? node.children.map(plainText).join('') : '';
}

// YAML gives us `unknown`. Keep only known fields with the right type; ignore the rest.
function readFrontmatter(source: string): Frontmatter {
  if (source.trim() === '') return {};
  const raw: unknown = parseYaml(source);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const data = raw as Record<string, unknown>;

  const text = (key: string): string | undefined => {
    const value = data[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  };
  const lang = text('lang')?.toLowerCase();

  return {
    title: text('title'),
    subtitle: text('subtitle'),
    client: text('client'),
    author: text('author'),
    date: text('date'),
    theme: text('theme'),
    cover: typeof data.cover === 'boolean' ? data.cover : undefined,
    lang: lang?.startsWith('pt') ? 'pt' : lang?.startsWith('en') ? 'en' : undefined,
  };
}
