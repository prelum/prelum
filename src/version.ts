import { readFileSync } from 'node:fs';

// `../package.json` resolves the same from src/ (dev) and dist/ (published).
export const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
