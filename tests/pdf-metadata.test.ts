import { describe, expect, it } from 'vitest';
import { sourceDateEpoch, stampMetadata } from '../src/pdf-metadata.ts';
import { render } from '../src/render.ts';
import { BROWSER_TEST_TIMEOUT } from './helpers.ts';

// The tail of a PDF as Chrome writes it, enough to exercise the replacements.
const chromeInfo = [
  '<</Creator (Mozilla/5.0 \\(Macintosh; Intel Mac OS X 10_15_7\\) Chrome)',
  "/Producer (Skia/PDF m151)/CreationDate (D:20261121004321+00'00')",
  "/ModDate (D:20261121004321+00'00')>>",
].join('\n');

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1');
const bytes = (value: string) => Buffer.from(value, 'latin1');

describe('stampMetadata', () => {
  it('stamps the given date and keeps every byte in place', () => {
    const stamped = stampMetadata(bytes(chromeInfo), new Date('2026-01-02T03:04:05Z'));

    expect(stamped.length).toBe(chromeInfo.length);
    expect(text(stamped)).toContain("/CreationDate (D:20260102030405+00'00')");
    expect(text(stamped)).toContain("/ModDate (D:20260102030405+00'00')");
  });

  it('replaces the browser user agent with prelum', () => {
    const stamped = text(stampMetadata(bytes(chromeInfo), undefined));

    expect(stamped).toMatch(/\/Creator \(prelum\) +\n/);
    expect(stamped).not.toContain('Macintosh');
  });

  it('keeps the real date when none is given', () => {
    expect(text(stampMetadata(bytes(chromeInfo), undefined))).toContain('D:20261121004321');
  });
});

describe('sourceDateEpoch', () => {
  it('reads seconds since 1970', () => {
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: '1767225600' })?.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('ignores a missing or invalid value', () => {
    expect(sourceDateEpoch({})).toBeUndefined();
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: 'yesterday' })).toBeUndefined();
  });
});

// Opens a real browser.
describe('reproducible output', () => {
  it('prints the same bytes for the same document and date', {
    timeout: BROWSER_TEST_TIMEOUT,
  }, async () => {
    const md = '---\ntitle: Twice\ncover: true\n---\n\n# Twice\n\nSame input, same output.';
    const creationDate = new Date('2026-01-01T00:00:00Z');

    const first = await render(md, { creationDate });
    await new Promise((resolve) => setTimeout(resolve, 1100)); // the clock moves past a second
    const second = await render(md, { creationDate });

    expect(Buffer.compare(first.pdf, second.pdf)).toBe(0);
    expect(text(first.pdf)).toContain('/Creator (prelum)');
  });
});
