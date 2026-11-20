import { describe, expect, it } from 'vitest';
import { coverHtml, formatDate } from '../src/cover.ts';

describe('formatDate', () => {
  const today = new Date(2026, 10, 20);

  it('writes ISO dates as month and year, in the document language', () => {
    expect(formatDate('2026-11-17', 'en', today)).toBe('November 2026');
    expect(formatDate('2026-11-17', 'pt', today)).toBe('novembro de 2026');
    expect(formatDate('2026-03', 'en', today)).toBe('March 2026');
  });

  it('uses the local month for auto, even late on its last day', () => {
    expect(formatDate('auto', 'en', new Date(2027, 0, 31, 23, 59))).toBe('January 2027');
  });

  it('keeps anything that is not an ISO date as written', () => {
    expect(formatDate('Q4 2026', 'en', today)).toBe('Q4 2026');
    expect(formatDate('2026-13-01', 'en', today)).toBe('2026-13-01');
  });

  it('returns nothing without a date', () => {
    expect(formatDate(undefined, 'en', today)).toBeUndefined();
  });
});

describe('coverHtml', () => {
  it('treats frontmatter as text, never markup', () => {
    const html = coverHtml({ title: 'A <b>bold</b> & "plan"' }, 'en');
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;plan&quot;');
    expect(html).not.toContain('<b>');
  });

  it('shows the subtitle only when there is one', () => {
    expect(coverHtml({ title: 'T' }, 'en')).not.toContain('subtitle');
    expect(coverHtml({ title: 'T', subtitle: 'Phase 1' }, 'en')).toContain(
      '<p class="subtitle">Phase 1</p>',
    );
  });
});
