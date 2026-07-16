import { describe, expect, it } from 'vitest';
import { applyHighlight, eraseHighlight, normalizeHighlights, segmentsFor } from '../src/data/citationHighlight';

const P = 'The quick brown fox'; // length 19; "quick" = [4,9)

describe('segmentsFor', () => {
  it('returns one plain segment when there are no highlights', () => {
    expect(segmentsFor(P, undefined)).toEqual([{ text: P, color: null }]);
  });

  it('splits the passage around a single highlight', () => {
    expect(segmentsFor(P, [{ start: 4, end: 9, color: 'yellow' }])).toEqual([
      { text: 'The ', color: null },
      { text: 'quick', color: 'yellow' },
      { text: ' brown fox', color: null },
    ]);
  });
});

describe('normalizeHighlights', () => {
  it('clamps out-of-range parts and drops empty ranges', () => {
    expect(
      normalizeHighlights([{ start: -5, end: 3, color: 'blue' }, { start: 10, end: 10, color: 'green' }], P.length),
    ).toEqual([{ start: 0, end: 3, color: 'blue' }]);
  });

  it('merges touching same-color ranges and sorts by position', () => {
    expect(
      normalizeHighlights(
        [{ start: 10, end: 15, color: 'pink' }, { start: 0, end: 4, color: 'green' }, { start: 4, end: 9, color: 'green' }],
        P.length,
      ),
    ).toEqual([
      { start: 0, end: 9, color: 'green' },
      { start: 10, end: 15, color: 'pink' },
    ]);
  });
});

describe('applyHighlight', () => {
  it('lets a later color win an overlapping region', () => {
    const first = applyHighlight(undefined, 0, 9, 'yellow', P.length);
    const next = applyHighlight(first, 4, 9, 'green', P.length);
    expect(next).toEqual([
      { start: 0, end: 4, color: 'yellow' },
      { start: 4, end: 9, color: 'green' },
    ]);
  });

  it('is a no-op for an empty selection', () => {
    expect(applyHighlight(undefined, 5, 5, 'blue', P.length)).toEqual([]);
  });
});

describe('eraseHighlight', () => {
  it('removes coverage from the middle, splitting the range', () => {
    const hl = applyHighlight(undefined, 0, 19, 'blue', P.length);
    expect(eraseHighlight(hl, 4, 9, P.length)).toEqual([
      { start: 0, end: 4, color: 'blue' },
      { start: 9, end: 19, color: 'blue' },
    ]);
  });
});
