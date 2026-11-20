/**
 * For tests that open a real browser. Locally a PDF takes ~2 s, but the first Chrome launch on a
 * fresh CI runner took 15–20 s (and over 30 s once), while the next ones took under 1 s.
 */
export const BROWSER_TEST_TIMEOUT = 90_000;
