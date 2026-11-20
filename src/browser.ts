import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type LaunchOptions } from 'playwright-core';

export type Candidate = { label: string; options: LaunchOptions };

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

/** Opens the first browser that works, in the order given by `browserCandidates`. */
export async function launchBrowser(): Promise<{ browser: Browser; label: string }> {
  const tried: { label: string; reason: string }[] = [];
  for (const candidate of await browserCandidates()) {
    try {
      return { browser: await chromium.launch(candidate.options), label: candidate.label };
    } catch (error) {
      tried.push({ label: candidate.label, reason: firstLine(error) });
    }
  }
  throw new BrowserNotFoundError(tried);
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
    return [{ label: env.PRELUM_CHROME, options: { executablePath: env.PRELUM_CHROME } }];
  }
  const candidates: Candidate[] = [
    { label: 'Chrome', options: { channel: 'chrome' } },
    { label: 'Edge', options: { channel: 'msedge' } },
  ];
  const cached = await findPlaywrightChromium(playwrightCacheDir(env, platform, home), platform);
  if (cached) candidates.push({ label: cached, options: { executablePath: cached } });
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
