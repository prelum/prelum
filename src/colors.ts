export type Paint = (text: string) => string;
export type Palette = { dim: Paint; ok: Paint; warn: Paint; error: Paint };

// Brand colors from the CLI spec. Body text keeps the terminal's own color:
// a fixed light color would vanish on light terminal themes.
const BRAND = { dim: '#8A8378', ok: '#7FBF8E', warn: '#E0B45A', error: '#E0583F' };
const BASIC = { dim: 2, ok: 32, warn: 33, error: 31 }; // dim, green, yellow, red

/** How many colors a stream can show: 1 (none), 4/8 (basic ANSI) or 24 (truecolor). */
export function colorDepth(stream: NodeJS.WriteStream, env: NodeJS.ProcessEnv): number {
  if (env.NO_COLOR) return 1; // https://no-color.org
  if (!stream.isTTY) return 1; // piped or redirected: plain text
  return stream.getColorDepth(env);
}

export function palette(depth: number): Palette {
  if (depth >= 24) {
    return {
      dim: truecolor(BRAND.dim),
      ok: truecolor(BRAND.ok),
      warn: truecolor(BRAND.warn),
      error: truecolor(BRAND.error),
    };
  }
  if (depth >= 4) {
    return {
      dim: ansi(BASIC.dim, 22),
      ok: ansi(BASIC.ok),
      warn: ansi(BASIC.warn),
      error: ansi(BASIC.error),
    };
  }
  const plain: Paint = (text) => text;
  return { dim: plain, ok: plain, warn: plain, error: plain };
}

function truecolor(hex: string): Paint {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return (text) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function ansi(open: number, close = 39): Paint {
  return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}
