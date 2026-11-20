import { escapeHtml } from './escape.ts';
import type { Frontmatter, Lang } from './markdown.ts';

export type CoverData = Pick<Frontmatter, 'subtitle' | 'client' | 'author' | 'date'> & {
  title: string;
};

export function coverHtml(data: CoverData, lang: Lang, today: Date = new Date()): string {
  const text = (value: string | undefined) => escapeHtml(value ?? '');
  const subtitle = data.subtitle ? `<p class="subtitle">${text(data.subtitle)}</p>` : '';

  return `<section class="prelum-cover">
  <div class="meta-top"><span>${text(data.client)}</span></div>
  <div class="heading">
    <div class="mark"></div>
    <h1>${text(data.title)}</h1>
    ${subtitle}
  </div>
  <div class="meta-bottom"><span>${text(data.author)}</span><span>${text(formatDate(data.date, lang, today))}</span></div>
</section>`;
}

/**
 * Cover dates read as "November 2026" / "novembro de 2026".
 * `auto` means today; anything that is not an ISO date ("Q4 2026") stays as written.
 */
export function formatDate(date: string | undefined, lang: Lang, today: Date): string | undefined {
  if (!date) return undefined;
  const month =
    date === 'auto' ? Date.UTC(today.getFullYear(), today.getMonth(), 1) : parseIsoMonth(date);
  if (month === undefined) return date;

  return new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(month);
}

function parseIsoMonth(date: string): number | undefined {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(date);
  if (!match) return undefined;
  const [, year, month] = match.map(Number);
  if (year === undefined || month === undefined || month < 1 || month > 12) return undefined;
  return Date.UTC(year, month - 1, 1);
}
