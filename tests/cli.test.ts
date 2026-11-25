import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_TEST_TIMEOUT } from './helpers.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;

type Run = { code: number; stdout: string; stderr: string };

/** Runs the real CLI in a child process, as a user would. Not a TTY, so no colors. */
function prelum(args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: dir, env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: '', ...env } },
      (error, stdout, stderr) => done({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prelum-cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('prelum CLI', () => {
  it('prints its version', async () => {
    const { code, stdout } = await prelum(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('speaks the terminal language, unless --lang says otherwise', async () => {
    expect((await prelum(['--help'], { LANG: 'pt_BR.UTF-8' })).stdout).toContain('Uso');
    expect((await prelum(['--help', '--lang', 'en'], { LANG: 'pt_BR.UTF-8' })).stdout).toContain(
      'Usage',
    );
  });

  it('lists the themes', async () => {
    const { stdout } = await prelum(['themes']);
    expect(stdout).toMatch(/report\s+default/);
    expect(stdout).toContain('technical');
  });

  it('exits 1 on an unknown option and points to --help', async () => {
    const { code, stderr } = await prelum(['--colour']);
    expect(code).toBe(1);
    expect(stderr).toContain('See: prelum --help');
  });

  it('exits 1 on a missing file', async () => {
    const { code, stderr } = await prelum(['nope.md']);
    expect(code).toBe(1);
    expect(stderr).toContain('file not found: nope.md');
  });

  it('exits 1 on a bad --format', async () => {
    const { code, stderr } = await prelum(['a.md', '--format', 'A5']);
    expect(code).toBe(1);
    expect(stderr).toContain('Use: A4, Letter');
  });

  it('suggests the closest theme on a typo', async () => {
    await writeFile(join(dir, 'a.md'), '# A');
    const { code, stderr } = await prelum(['a.md', '-t', 'reportt']);
    expect(code).toBe(1);
    expect(stderr).toContain('Did you mean "report"?');
  });

  it('refuses one .pdf output for several inputs', async () => {
    const { code, stderr } = await prelum(['a.md', 'b.md', '-o', 'out.pdf']);
    expect(code).toBe(1);
    expect(stderr).toContain('--out dist/');
  });

  it('exits 3 and says how to get a browser', async () => {
    await writeFile(join(dir, 'a.md'), '# A');
    const { code, stderr } = await prelum(['a.md'], { PRELUM_CHROME: join(dir, 'no-chrome') });
    expect(code).toBe(3);
    expect(stderr).toContain('npx playwright install chromium');
  });

  it('exits 3 when the pinned browser is not installed, with no fallback', async () => {
    await writeFile(join(dir, 'a.md'), '# A');
    // An empty browser cache: Chrome or Edge may be installed, but pinned mode must not use them.
    const { code, stderr } = await prelum(['a.md', '--pinned-browser'], {
      PLAYWRIGHT_BROWSERS_PATH: dir,
    });
    expect(code).toBe(3);
    expect(stderr).toContain('pinned browser not installed');
    expect(stderr).toMatch(/npx playwright@\d+\.\d+\.\d+ install chromium/);
  });

  // Opens a real browser.
  it('writes the PDF next to the .md and reports in Portuguese', {
    timeout: BROWSER_TEST_TIMEOUT,
  }, async () => {
    await writeFile(
      join(dir, 'relatorio.md'),
      '---\ncover: true\n---\n\n# Relatório\n\nUm dois três.',
    );
    const { code, stdout } = await prelum(['relatorio.md', '--html'], { LANG: 'pt_BR.UTF-8' });

    expect(code).toBe(0);
    expect(stdout).toContain('4 palavras');
    expect(stdout).toContain('capa, 2 páginas');
    expect(stdout).toMatch(/navegador +(Chrome|Edge|Chromium) \d+\./);
    expect(stdout).toMatch(/■ relatorio\.pdf pronto em \d+,\d s/);
    expect((await readFile(join(dir, 'relatorio.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await readFile(join(dir, 'relatorio.html'), 'utf8')).toContain(
      '--prelum-page: "Página"',
    );
  });
});
