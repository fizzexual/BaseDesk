import type { CitationHighlight } from '../../data/types';
import { HL_CLASS, segmentsFor } from '../../data/citationHighlight';

/** Renders a cited passage with its highlight ranges painted as <mark>s. Dependency-light
    (no store/router) so both the agent thread and the customer portal can reuse it. */
export function CitationPassage({ passage, highlights }: { passage: string; highlights?: CitationHighlight[] }) {
  return (
    <>
      {segmentsFor(passage, highlights).map((seg, i) =>
        seg.color === null ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <mark key={i} className={HL_CLASS[seg.color]}>
            {seg.text}
          </mark>
        ),
      )}
    </>
  );
}
