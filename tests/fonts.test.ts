import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAMILIES, fontFaceCss, fontFiles } from '../src/fonts.ts';

describe('fonts', () => {
  it('ships every file the @font-face rules point to', () => {
    const missing = fontFiles().filter((url) => !existsSync(fileURLToPath(url)));
    expect(missing).toEqual([]);
  });

  it('ships the OFL license next to each family', () => {
    for (const family of FAMILIES) {
      const license = new URL(`../fonts/${family.slug}/OFL.txt`, import.meta.url);
      expect(existsSync(fileURLToPath(license)), family.name).toBe(true);
    }
  });

  it('uses the family names the themes ask for', () => {
    const css = fontFaceCss();
    for (const name of ['Newsreader', 'Schibsted Grotesk', 'JetBrains Mono']) {
      expect(css).toContain(`font-family: "${name}";`);
    }
  });

  it('loads fonts from local files only, never from the network', () => {
    const sources = [...fontFaceCss().matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((src) => src?.startsWith('file://'))).toBe(true);
  });
});
