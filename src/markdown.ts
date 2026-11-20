import type { Element, Nodes as HastNodes, Root as HastRoot } from 'hast';
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
  /** The document body, without the leading title (see `leadingTitle`). */
  html: string;
  /**
   * A `#` heading that opens the document, kept apart so the renderer can drop it
   * when the cover already shows the same title.
   */
  leadingTitle: { text: string; html: string } | undefined;
  frontmatter: Frontmatter;
  /** Text of the first `#` heading anywhere: the title when the frontmatter has none. */
  firstHeading: string | undefined;
  words: number;
  diagrams: number;
};

type Findings = {
  yaml: string;
  firstHeading: string | undefined;
  leading: Element | undefined;
  words: number;
  diagrams: number;
};

export async function markdownToHtml(markdown: string): Promise<MarkdownResult> {
  const found: Findings = {
    yaml: '',
    firstHeading: undefined,
    leading: undefined,
    words: 0,
    diagrams: 0,
  };

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(() => (tree: Root) => inspect(tree, found))
    // Raw HTML passes through, as it did with pandoc (e.g. a manual page break).
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(() => (tree: HastRoot) => {
      replaceMermaidBlocks(tree);
      found.leading = takeLeadingTitle(tree);
    })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = await processor.process(markdown);
  const leading = found.leading;

  return {
    html: String(file),
    leadingTitle: leading && {
      text: hastText(leading),
      html: processor.stringify({ type: 'root', children: [leading] }),
    },
    frontmatter: readFrontmatter(found.yaml),
    firstHeading: found.firstHeading,
    words: found.words,
    diagrams: found.diagrams,
  };
}

/**
 * ```mermaid fences arrive as <pre><code class="language-mermaid">. The whole <pre> becomes
 * <div class="mermaid">: left inside a <pre>, the diagram would get the theme's code block style.
 */
function replaceMermaidBlocks(parent: HastRoot | Element): void {
  parent.children.forEach((child, index) => {
    if (child.type !== 'element') return;
    const code = child.tagName === 'pre' ? child.children[0] : undefined;
    const classes = code?.type === 'element' ? code.properties.className : undefined;
    if (code && Array.isArray(classes) && classes.includes('language-mermaid')) {
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['mermaid'] },
        children: [{ type: 'text', value: hastText(code) }],
      };
    } else {
      replaceMermaidBlocks(child);
    }
  });
}

/** Removes and returns the first element of the document when it is an `<h1>`. */
function takeLeadingTitle(tree: HastRoot): Element | undefined {
  const index = tree.children.findIndex((node) => node.type === 'element');
  const first = tree.children[index];
  if (first?.type !== 'element' || first.tagName !== 'h1') return undefined;
  tree.children.splice(index, 1);
  return first;
}

function hastText(node: HastNodes): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(hastText).join('') : '';
}

// One pass over the markdown tree collects everything the CLI reports.
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
        if (node.lang === 'mermaid') found.diagrams += 1;
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
