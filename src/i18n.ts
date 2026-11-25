import type { Lang } from './markdown.ts';

/** Portuguese when the terminal locale starts with "pt" (pt_BR.UTF-8, pt-PT…), English otherwise. */
export function detectLang(env: NodeJS.ProcessEnv): Lang {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  return locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export type Messages = ReturnType<typeof messages>;

export function messages(lang: Lang) {
  const number = new Intl.NumberFormat(lang === 'pt' ? 'pt-BR' : 'en-US');
  const seconds = new Intl.NumberFormat(lang === 'pt' ? 'pt-BR' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const n = (count: number) => number.format(count);
  const plural = (count: number, one: string, many: string) =>
    `${n(count)} ${count === 1 ? one : many}`;
  const list = (items: string[]) => items.join(', ');

  if (lang === 'pt') {
    return {
      label: {
        markdown: 'markdown',
        mermaid: 'mermaid',
        image: 'imagem',
        theme: 'tema',
        pages: 'paginação',
        browser: 'navegador',
        html: 'html',
      },
      words: (count: number) => plural(count, 'palavra', 'palavras'),
      diagrams: (count: number) => plural(count, 'diagrama', 'diagramas'),
      pages: (count: number, cover: boolean) =>
        `${cover ? 'capa, ' : ''}${plural(count, 'página', 'páginas')}`,
      missingImage: (src: string) => `${src} não encontrada`,
      diagramError: (message: string) => `um diagrama não foi desenhado: ${message}`,
      ready: (file: string, ms: number) => `${file} pronto em ${seconds.format(ms / 1000)} s`,
      fileNotFound: (file: string) => [`arquivo não encontrado: ${file}`],
      cssNotFound: (file: string) => [`CSS não encontrado: ${file}`],
      themeNotFound: (theme: string, available: string[], suggestion?: string) => [
        `tema "${theme}" não encontrado`,
        `Temas instalados: ${list(available)}`,
        ...(suggestion ? [`Você quis dizer "${suggestion}"?`] : []),
      ],
      badFrontmatter: (file: string, message: string) => [
        `frontmatter inválido em ${file}`,
        message,
        'Confira a indentação e as aspas do bloco entre os dois ---.',
      ],
      browserMissing: () => [
        'nenhum navegador Chromium encontrado (Chrome, Edge ou Chromium)',
        'Execute: npx playwright install chromium   (baixa o Chromium uma vez, ~150 MB)',
        'Ou aponte PRELUM_CHROME para o executável de um navegador Chromium.',
      ],
      pinnedBrowser: (expected: string, playwright: string, found?: string) => [
        found
          ? `o navegador fixado é o Chromium ${found}, mas o playwright-core ${playwright} espera o ${expected}`
          : `navegador fixado não instalado: Chromium ${expected} (do playwright-core ${playwright})`,
        `Execute: npx playwright@${playwright} install chromium   (baixa essa versão uma vez, ~150 MB)`,
      ],
      renderFailed: (file: string, message: string) => [`falha ao gerar ${file}`, message],
      badOption: (message: string) => [message, 'Veja: prelum --help'],
      badValue: (flag: string, value: string, allowed: string[]) => [
        `valor inválido para ${flag}: "${value}"`,
        `Use: ${list(allowed)}`,
      ],
      outMustBeFolder: () => [
        '--out aponta para um .pdf, mas há mais de um arquivo de entrada',
        'Passe uma pasta: --out dist/',
      ],
      noInput: () => ['nenhum arquivo .md informado', 'Exemplo: prelum relatorio.md'],
      themesDefault: 'padrão',
      help: (version: string) => `
  prelum■ ${version} — Do markdown ao papel, sem CSS.

  Uso
    prelum <arquivos...> [opções]
    prelum themes                lista os temas instalados

  Opções
    -t, --theme <nome>           tema (padrão: report)
    -o, --out <caminho>          arquivo ou pasta de saída (padrão: ao lado do .md)
        --format <A4|Letter>     tamanho do papel (padrão: A4)
        --cover, --no-cover      com ou sem capa (padrão: do frontmatter)
        --css <arquivo>          CSS extra depois do tema
        --html                   salva também o HTML intermediário
        --pinned-browser         só o Chromium que o playwright-core espera
        --lang <en|pt>           idioma das mensagens
    -h, --help                   esta ajuda
    -v, --version                versão
`,
    };
  }

  return {
    label: {
      markdown: 'markdown',
      mermaid: 'mermaid',
      image: 'image',
      theme: 'theme',
      pages: 'pages',
      browser: 'browser',
      html: 'html',
    },
    words: (count: number) => plural(count, 'word', 'words'),
    diagrams: (count: number) => plural(count, 'diagram', 'diagrams'),
    pages: (count: number, cover: boolean) =>
      `${cover ? 'cover, ' : ''}${plural(count, 'page', 'pages')}`,
    missingImage: (src: string) => `${src} not found`,
    diagramError: (message: string) => `a diagram was not drawn: ${message}`,
    ready: (file: string, ms: number) => `${file} ready in ${seconds.format(ms / 1000)} s`,
    fileNotFound: (file: string) => [`file not found: ${file}`],
    cssNotFound: (file: string) => [`CSS file not found: ${file}`],
    themeNotFound: (theme: string, available: string[], suggestion?: string) => [
      `theme "${theme}" not found`,
      `Installed themes: ${list(available)}`,
      ...(suggestion ? [`Did you mean "${suggestion}"?`] : []),
    ],
    badFrontmatter: (file: string, message: string) => [
      `invalid frontmatter in ${file}`,
      message,
      'Check the indentation and quotes in the block between the two ---.',
    ],
    browserMissing: () => [
      'no Chromium-based browser found (Chrome, Edge or Chromium)',
      'Run: npx playwright install chromium   (downloads Chromium once, ~150 MB)',
      'Or point PRELUM_CHROME to any Chromium-based browser executable.',
    ],
    pinnedBrowser: (expected: string, playwright: string, found?: string) => [
      found
        ? `the pinned browser is Chromium ${found}, but playwright-core ${playwright} expects ${expected}`
        : `pinned browser not installed: Chromium ${expected} (from playwright-core ${playwright})`,
      `Run: npx playwright@${playwright} install chromium   (downloads that build once, ~150 MB)`,
    ],
    renderFailed: (file: string, message: string) => [`could not render ${file}`, message],
    badOption: (message: string) => [message, 'See: prelum --help'],
    badValue: (flag: string, value: string, allowed: string[]) => [
      `invalid value for ${flag}: "${value}"`,
      `Use: ${list(allowed)}`,
    ],
    outMustBeFolder: () => [
      '--out points to a .pdf, but there is more than one input file',
      'Pass a folder instead: --out dist/',
    ],
    noInput: () => ['no .md file given', 'Example: prelum report.md'],
    themesDefault: 'default',
    help: (version: string) => `
  prelum■ ${version} — Markdown in. Beautiful PDF out.

  Usage
    prelum <files...> [options]
    prelum themes                list installed themes

  Options
    -t, --theme <name>           theme (default: report)
    -o, --out <path>             output file or folder (default: next to the .md)
        --format <A4|Letter>     paper size (default: A4)
        --cover, --no-cover      with or without a cover (default: from the frontmatter)
        --css <file>             extra CSS after the theme
        --html                   also save the intermediate HTML
        --pinned-browser         only the Chromium build playwright-core expects
        --lang <en|pt>           language of messages
    -h, --help                   this help
    -v, --version                version
`,
  };
}
