// Chrome stamps every PDF with the time it was printed and the browser's user agent. The time
// makes two runs on the same file differ; the user agent leaks the OS and differs per machine.
//
// A PDF ends with a table of byte offsets to its objects, so edits must keep every byte where it
// was: each replacement below has exactly the length of what it replaces.

const DATE_FIELD = /\/(CreationDate|ModDate) \(D:\d{14}\+00'00'\)/g;
const CREATOR_FIELD = /\/Creator \((?:\\.|[^\\)])*\)/;

/**
 * Same document in, same bytes out: dates become `date` (when given) and the creator becomes
 * `creator` ("prelum 0.2.0 · Chrome 151.0.7922.34"), or just "prelum" when that does not fit. Use
 * `SOURCE_DATE_EPOCH`, the reproducible-builds convention, to pick the date.
 */
export function stampMetadata(
  pdf: Uint8Array,
  date: Date | undefined,
  creator = 'prelum',
): Uint8Array {
  let text = Buffer.from(pdf).toString('latin1');

  if (date) {
    const stamp = `D:${date.toISOString().replace(/\D/g, '').slice(0, 14)}+00'00'`;
    text = text.replace(DATE_FIELD, (_match, field: string) => `/${field} (${stamp})`);
  }

  text = text.replace(CREATOR_FIELD, (match) => {
    // Whitespace between dictionary entries is insignificant: pad with spaces.
    const field = [`/Creator (${pdfString(creator)})`, '/Creator (prelum)'].find(
      (candidate) => candidate.length <= match.length,
    );
    return field ? field.padEnd(match.length, ' ') : match;
  });

  return Buffer.from(text, 'latin1');
}

/** A PDF literal string: backslashes and parentheses escaped, one Latin-1 byte per character. */
const pdfString = (value: string) => value.replace(/[\\()]/g, '\\$&');

/** The date from `SOURCE_DATE_EPOCH` (seconds since 1970), if set and valid. */
export function sourceDateEpoch(env: NodeJS.ProcessEnv): Date | undefined {
  const value = env.SOURCE_DATE_EPOCH;
  if (!value || !/^\d+$/.test(value)) return undefined;
  return new Date(Number(value) * 1000);
}
