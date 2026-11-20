import { describe, expect, it } from 'vitest';
import { colorDepth, palette } from '../src/colors.ts';
import { detectLang, messages } from '../src/i18n.ts';

const stream = (isTTY: boolean, depth = 24) =>
  ({ isTTY, getColorDepth: () => depth }) as unknown as NodeJS.WriteStream;

describe('colors', () => {
  it('turns colors off for NO_COLOR and for pipes', () => {
    expect(colorDepth(stream(true), { NO_COLOR: '1' })).toBe(1);
    expect(colorDepth(stream(false), {})).toBe(1);
    expect(colorDepth(stream(true, 8), {})).toBe(8);
  });

  it('uses the brand colors in truecolor terminals', () => {
    expect(palette(24).ok('✓')).toBe('\x1b[38;2;127;191;142m✓\x1b[39m');
  });

  it('falls back to basic ANSI, then to plain text', () => {
    expect(palette(8).error('✗')).toBe('\x1b[31m✗\x1b[39m');
    expect(palette(1).error('✗')).toBe('✗');
  });
});

describe('i18n', () => {
  it('detects Portuguese from the locale', () => {
    expect(detectLang({ LANG: 'pt_BR.UTF-8' })).toBe('pt');
    expect(detectLang({ LANG: 'en_US.UTF-8', LC_ALL: 'pt_PT.UTF-8' })).toBe('pt');
    expect(detectLang({})).toBe('en');
  });

  it('formats numbers the local way', () => {
    expect(messages('pt').words(3214)).toBe('3.214 palavras');
    expect(messages('en').words(3214)).toBe('3,214 words');
    expect(messages('en').words(1)).toBe('1 word');
    expect(messages('pt').ready('a.pdf', 812)).toBe('a.pdf pronto em 0,8 s');
  });
});
