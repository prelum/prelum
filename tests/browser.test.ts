import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browserCandidates, findPlaywrightChromium, playwrightCacheDir } from '../src/browser.ts';

// A fake Playwright cache in a temp folder: no real browser needed to run these tests.
let cache: string;
beforeEach(async () => {
  cache = await mkdtemp(join(tmpdir(), 'prelum-cache-'));
});
afterEach(async () => {
  await rm(cache, { recursive: true, force: true });
});

async function touch(...parts: string[]): Promise<string> {
  const path = join(cache, ...parts);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
  return path;
}

async function fakeRevision(name: string, executable: string[], complete = true): Promise<string> {
  if (complete) await touch(name, 'INSTALLATION_COMPLETE');
  return touch(name, ...executable);
}

const macApp = (folder: string, app: string) => [folder, `${app}.app`, 'Contents', 'MacOS', app];

describe('findPlaywrightChromium', () => {
  it('picks the newest revision, whatever its folder layout', async () => {
    await fakeRevision('chromium-1194', macApp('chrome-mac', 'Chromium'));
    const newest = await fakeRevision(
      'chromium-1234',
      macApp('chrome-mac-arm64', 'Google Chrome for Testing'),
    );

    expect(await findPlaywrightChromium(cache, 'darwin')).toBe(newest);
  });

  it('compares revisions as numbers, not text', async () => {
    await fakeRevision('chromium-999', ['chrome-linux', 'chrome']);
    const newest = await fakeRevision('chromium-1000', ['chrome-linux64', 'chrome']);

    expect(await findPlaywrightChromium(cache, 'linux')).toBe(newest);
  });

  it('skips an interrupted download', async () => {
    const complete = await fakeRevision('chromium-1194', ['chrome-win', 'chrome.exe']);
    await fakeRevision('chromium-1234', ['chrome-win64', 'chrome.exe'], false);

    expect(await findPlaywrightChromium(cache, 'win32')).toBe(complete);
  });

  it('ignores other Playwright browsers', async () => {
    await fakeRevision('chromium_headless_shell-1234', ['chrome-linux', 'chrome']);
    await fakeRevision('firefox-1500', ['firefox', 'firefox']);

    expect(await findPlaywrightChromium(cache, 'linux')).toBeUndefined();
  });

  it('returns undefined when there is no cache', async () => {
    expect(await findPlaywrightChromium(join(cache, 'missing'), 'linux')).toBeUndefined();
  });
});

describe('playwrightCacheDir', () => {
  it('follows Playwright defaults per platform', () => {
    expect(playwrightCacheDir({}, 'darwin', '/Users/ana')).toBe(
      join('/Users/ana', 'Library', 'Caches', 'ms-playwright'),
    );
    expect(playwrightCacheDir({}, 'linux', '/home/ana')).toBe(
      join('/home/ana', '.cache', 'ms-playwright'),
    );
    expect(playwrightCacheDir({ LOCALAPPDATA: 'C:/Users/ana/AppData/Local' }, 'win32', '')).toBe(
      join('C:/Users/ana/AppData/Local', 'ms-playwright'),
    );
  });

  it('honors PLAYWRIGHT_BROWSERS_PATH', () => {
    expect(playwrightCacheDir({ PLAYWRIGHT_BROWSERS_PATH: '/opt/pw' }, 'linux', '/home/ana')).toBe(
      '/opt/pw',
    );
  });
});

describe('browserCandidates', () => {
  it('uses only PRELUM_CHROME when set', async () => {
    const candidates = await browserCandidates(
      { PRELUM_CHROME: '/opt/brave' },
      'linux',
      '/home/ana',
    );
    expect(candidates).toEqual([
      { label: '/opt/brave', options: { executablePath: '/opt/brave' } },
    ]);
  });

  it('tries Chrome, then Edge, then the Playwright cache', async () => {
    const cached = await fakeRevision('chromium-1234', ['chrome-linux64', 'chrome']);
    const candidates = await browserCandidates({ PLAYWRIGHT_BROWSERS_PATH: cache }, 'linux', '');

    expect(candidates.map((c) => c.label)).toEqual(['Chrome', 'Edge', cached]);
  });

  it('leaves the cache out when it has no Chromium', async () => {
    const candidates = await browserCandidates({ PLAYWRIGHT_BROWSERS_PATH: cache }, 'linux', '');
    expect(candidates.map((c) => c.label)).toEqual(['Chrome', 'Edge']);
  });
});
