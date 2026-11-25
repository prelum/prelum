import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Browser, chromium, type LaunchOptions } from 'playwright-core';

/** `label` names the candidate in errors (a path for a cached Chromium); `name` is for display. */
export type Candidate = { label: string; name: string; options: LaunchOptions };

export type LaunchedBrowser = {
  browser: Browser;
  /** For display and the PDF metadata: "Chrome 151.0.7922.34". */
  description: string;
};

/** The Chromium build the installed playwright-core was released with. */
export type PinnedChromium = { version: string; playwright: string; executablePath: string };

export class BrowserNotFoundError extends Error {
  readonly tried: { label: string; reason: string }[];

  constructor(tried: { label: string; reason: string }[]) {
    super(
      `No Chromium-based browser could be launched (tried: ${tried.map((t) => t.label).join(', ')})`,
    );
    this.name = 'BrowserNotFoundError';
    this.tried = tried;
  }
}

/** Pinned mode only: the expected Chromium is missing (`found` undefined) or reports another version. */
export class PinnedBrowserError extends Error {
  readonly expected: PinnedChromium;
  readonly found: string | undefined;

  constructor(expected: PinnedChromium, found?: string) {
    super(
      found
        ? `Pinned browser reports Chromium ${found}, expected ${expected.version}`
        : `Pinned browser Chromium ${expected.version} is not installed`,
    );
    this.name = 'PinnedBrowserError';
    this.expected = expected;
    this.found = found;
  }
}

/**
 * Opens the first browser that works, in the order given by `browserCandidates`. With `pinned`,
 * opens only the Chromium that playwright-core expects, and fails on anything else: a different
 * version can break lines and pages differently.
 */
export async function launchBrowser(options: { pinned?: boolean } = {}): Promise<LaunchedBrowser> {
  if (options.pinned) return launchPinned(pinnedChromium());

  const tried: { label: string; reason: string }[] = [];
  for (const candidate of await browserCandidates()) {
    try {
      const browser = await chromium.launch(candidate.options);
      return { browser, description: `${candidate.name} ${browser.version()}` };
    } catch (error) {
      tried.push({ label: candidate.label, reason: firstLine(error) });
    }
  }
  throw new BrowserNotFoundError(tried);
}

async function launchPinned(expected: PinnedChromium): Promise<LaunchedBrowser> {
  if (!existsSync(expected.executablePath)) throw new PinnedBrowserError(expected);

  let browser: Browser;
  try {
    browser = await chromium.launch({ executablePath: expected.executablePath });
  } catch {
    throw new PinnedBrowserError(expected); // an interrupted or damaged download: install again
  }
  const found = browser.version();
  if (found !== expected.version) {
    await browser.close();
    throw new PinnedBrowserError(expected, found);
  }
  return { browser, description: `Chromium ${found}` };
}

/**
 * Read from playwright-core itself: `browsers.json` lists the build it was tested with, and
 * `executablePath()` says where `playwright install chromium` puts it (PLAYWRIGHT_BROWSERS_PATH
 * included). Nothing is downloaded here.
 */
export function pinnedChromium(): PinnedChromium {
  const manifest = createRequire(import.meta.url).resolve('playwright-core/package.json');
  const read = (file: string) => JSON.parse(readFileSync(join(dirname(manifest), file), 'utf8'));
  const { version: playwright } = read('package.json') as { version: string };
  const { browsers } = read('browsers.json') as {
    browsers: { name: string; browserVersion: string }[];
  };
  const entry = browsers.find((browser) => browser.name === 'chromium');
  if (!entry) throw new Error(`playwright-core ${playwright} lists no Chromium build`);
  return { version: entry.browserVersion, playwright, executablePath: chromium.executablePath() };
}

/**
 * Where to look, in order. Nothing is downloaded:
 * PRELUM_CHROME (explicit, no fallback) → Chrome → Edge → a Chromium already fetched by Playwright.
 */
export async function browserCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): Promise<Candidate[]> {
  if (env.PRELUM_CHROME) {
    return [
      {
        label: env.PRELUM_CHROME,
        name: 'Chromium',
        options: { executablePath: env.PRELUM_CHROME },
      },
    ];
  }
  const candidates: Candidate[] = [
    { label: 'Chrome', name: 'Chrome', options: { channel: 'chrome' } },
    { label: 'Edge', name: 'Edge', options: { channel: 'msedge' } },
  ];
  const cached = await findPlaywrightChromium(playwrightCacheDir(env, platform, home), platform);
  if (cached) {
    candidates.push({ label: cached, name: 'Chromium', options: { executablePath: cached } });
  }
  return candidates;
}

export function playwrightCacheDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright');
  }
  return join(home, '.cache', 'ms-playwright');
}

/**
 * Newest complete `chromium-<revision>` in the Playwright cache. The folder layout changes
 * between revisions (chrome-mac vs chrome-mac-arm64, Chromium.app vs
 * "Google Chrome for Testing.app"), so we look instead of hardcoding paths.
 */
export async function findPlaywrightChromium(
  cacheDir: string,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  if (!existsSync(cacheDir)) return undefined;

  const revisions = (await readdir(cacheDir))
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => revision(b) - revision(a));

  for (const name of revisions) {
    const dir = join(cacheDir, name);
    // Playwright writes this marker last; without it the download was interrupted.
    if (!existsSync(join(dir, 'INSTALLATION_COMPLETE'))) continue;

    for (const sub of await readdir(dir)) {
      if (!sub.startsWith('chrome-')) continue;
      const executable = await executableIn(join(dir, sub), platform);
      if (executable) return executable;
    }
  }
  return undefined;
}

async function executableIn(dir: string, platform: NodeJS.Platform): Promise<string | undefined> {
  if (platform === 'darwin') {
    const apps = (await readdir(dir)).filter((name) => name.endsWith('.app'));
    return apps
      .map((app) => join(dir, app, 'Contents', 'MacOS', app.slice(0, -'.app'.length)))
      .find((path) => existsSync(path));
  }
  const path = join(dir, platform === 'win32' ? 'chrome.exe' : 'chrome');
  return existsSync(path) ? path : undefined;
}

const revision = (name: string) => Number(name.slice('chromium-'.length));

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
