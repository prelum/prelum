// The brand fonts ship inside the package (OFL, from Fontsource), so every machine prints the
// same PDF: no Google Fonts at runtime, and a different version installed locally never wins.
const FONTS_DIR = new URL('../fonts/', import.meta.url);

// Google Fonts subsets: Latin covers English and Portuguese; Latin Extended the rest of Europe.
const RANGES = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};

type Family = {
  /** The name themes use in `font-family`. */
  name: string;
  /** Folder and file prefix under fonts/. */
  slug: string;
  /** Variable font axis in the file name: `opsz` also adapts the letterforms to the size. */
  axis: 'opsz' | 'wght';
  weights: string;
  styles: ('normal' | 'italic')[];
};

export const FAMILIES: Family[] = [
  {
    name: 'Newsreader',
    slug: 'newsreader',
    axis: 'opsz',
    weights: '200 800',
    styles: ['normal', 'italic'],
  },
  {
    name: 'Schibsted Grotesk',
    slug: 'schibsted-grotesk',
    axis: 'wght',
    weights: '400 900',
    styles: ['normal', 'italic'],
  },
  {
    name: 'JetBrains Mono',
    slug: 'jetbrains-mono',
    axis: 'wght',
    weights: '100 800',
    styles: ['normal'],
  },
];

/** Every bundled font file, as a URL. */
export function fontFiles(): URL[] {
  return faces().map((face) => face.url);
}

/** @font-face rules pointing at the bundled files. */
export function fontFaceCss(): string {
  return faces()
    .map(
      (face) => `@font-face {
  font-family: "${face.name}";
  font-style: ${face.style};
  font-weight: ${face.weights};
  font-display: block;
  src: url("${face.url.href}") format("woff2");
  unicode-range: ${RANGES[face.range]};
}`,
    )
    .join('\n');
}

function faces() {
  return FAMILIES.flatMap((family) =>
    family.styles.flatMap((style) =>
      (['latin', 'latin-ext'] as const).map((range) => ({
        ...family,
        style,
        range,
        url: new URL(
          `${family.slug}/${family.slug}-${range}-${family.axis}-${style}.woff2`,
          FONTS_DIR,
        ),
      })),
    ),
  );
}
