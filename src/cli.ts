#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// `../package.json` resolves the same from src/ (dev) and dist/ (published).
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

console.log(`\n  prelum■ ${pkg.version}\n`);
