import { readdir, readFile } from 'node:fs/promises';

// themes/ sits next to src/ and dist/, so this resolves the same in dev and once published.
const THEMES_DIR = new URL('../themes/', import.meta.url);

export const DEFAULT_THEME = 'report';

export class ThemeNotFoundError extends Error {
  readonly theme: string;
  readonly available: string[];
  readonly suggestion: string | undefined;

  constructor(theme: string, available: string[]) {
    super(`Theme "${theme}" not found (available: ${available.join(', ')})`);
    this.name = 'ThemeNotFoundError';
    this.theme = theme;
    this.available = available;
    this.suggestion = closest(theme, available);
  }
}

export async function listThemes(): Promise<string[]> {
  const entries = await readdir(THEMES_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function loadTheme(name: string): Promise<string> {
  const available = await listThemes();
  if (!available.includes(name)) throw new ThemeNotFoundError(name, available);
  return readFile(new URL(`${name}/theme.css`, THEMES_DIR), 'utf8');
}

/** The option within two typos of the input, for "did you mean". */
function closest(input: string, options: string[]): string | undefined {
  let best: { option: string; distance: number } | undefined;
  for (const option of options) {
    const distance = editDistance(input.toLowerCase(), option);
    if (distance <= 2 && (!best || distance < best.distance)) best = { option, distance };
  }
  return best?.option;
}

/** Levenshtein distance: insertions, deletions and substitutions needed to turn a into b. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
