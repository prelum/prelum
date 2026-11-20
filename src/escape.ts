const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Frontmatter values are plain text: they must never become markup. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

/** A quoted CSS string, safe to use as `content` or as a custom property value. */
export const cssString = (text: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ')}"`;
