// Pure helpers for highlighting words/sentences inside a cited passage.
// Highlights are stored as [start, end) character ranges over the passage string,
// which is stable because the passage text is fixed once picked from the article.

import type { CitationHighlight, HighlightColor } from './types';

/** Highlighter colors in the order shown in the composer swatch row. */
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

/** Human labels for the swatches (tooltips / aria). */
export const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
};

/** CSS class pair (defined in globals.css) that paints each highlight color. */
export const HL_CLASS: Record<HighlightColor, string> = {
  yellow: 'cite-hl cite-hl-yellow',
  green: 'cite-hl cite-hl-green',
  blue: 'cite-hl cite-hl-blue',
  pink: 'cite-hl cite-hl-pink',
};

/** A contiguous run of passage text, highlighted in `color` or plain when null. */
export interface Segment { text: string; color: HighlightColor | null; }

const COLOR_SET = new Set<HighlightColor>(HIGHLIGHT_COLORS);

/** Per-character color map for a passage of length `len`; later ranges win any overlap. */
function charColors(len: number, highlights: CitationHighlight[] | undefined): (HighlightColor | null)[] {
  const arr: (HighlightColor | null)[] = new Array(len).fill(null);
  for (const h of highlights ?? []) {
    if (!COLOR_SET.has(h.color)) continue;
    const s = Math.max(0, Math.min(Math.trunc(h.start), len));
    const e = Math.max(0, Math.min(Math.trunc(h.end), len));
    for (let i = s; i < e; i++) arr[i] = h.color;
  }
  return arr;
}

/** Collapse to sorted, non-overlapping ranges (contiguous same-color runs), clamped to [0, len). */
export function normalizeHighlights(highlights: CitationHighlight[] | undefined, len: number): CitationHighlight[] {
  const cc = charColors(len, highlights);
  const out: CitationHighlight[] = [];
  let i = 0;
  while (i < len) {
    const color = cc[i];
    if (color === null) { i++; continue; }
    let j = i + 1;
    while (j < len && cc[j] === color) j++;
    out.push({ start: i, end: j, color });
    i = j;
  }
  return out;
}

/** Split `passage` into runs for rendering, honoring the highlight ranges. */
export function segmentsFor(passage: string, highlights: CitationHighlight[] | undefined): Segment[] {
  const cc = charColors(passage.length, highlights);
  const out: Segment[] = [];
  let i = 0;
  while (i < passage.length) {
    const color = cc[i];
    let j = i + 1;
    while (j < passage.length && cc[j] === color) j++;
    out.push({ text: passage.slice(i, j), color });
    i = j;
  }
  return out;
}

/** Add a highlight over [start, end) in `color`; the new range wins any overlap. */
export function applyHighlight(
  highlights: CitationHighlight[] | undefined,
  start: number,
  end: number,
  color: HighlightColor,
  len: number,
): CitationHighlight[] {
  if (end <= start) return normalizeHighlights(highlights, len);
  return normalizeHighlights([...(highlights ?? []), { start, end, color }], len);
}

/** Remove any highlight coverage over [start, end). */
export function eraseHighlight(
  highlights: CitationHighlight[] | undefined,
  start: number,
  end: number,
  len: number,
): CitationHighlight[] {
  if (end <= start) return normalizeHighlights(highlights, len);
  const clipped = normalizeHighlights(highlights, len).flatMap((h) => {
    const parts: CitationHighlight[] = [];
    if (h.start < start) parts.push({ start: h.start, end: Math.min(h.end, start), color: h.color });
    if (h.end > end) parts.push({ start: Math.max(h.start, end), end: h.end, color: h.color });
    return parts.filter((p) => p.end > p.start);
  });
  return normalizeHighlights(clipped, len);
}
