import { useRef, useState } from 'react';
import type { HighlightColor, KbCitation } from '../../data/types';
import { applyHighlight, eraseHighlight, HIGHLIGHT_COLORS, HIGHLIGHT_LABELS } from '../../data/citationHighlight';
import { CitationPassage } from '../kb/CitationPassage';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconBook, IconX } from '../../icons';

/** Character offset of a selection boundary within `container`, counting only its text. */
function offsetWithin(container: HTMLElement, node: Node, nodeOffset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, nodeOffset);
  return range.toString().length;
}

type Sel = { start: number; end: number };

/**
 * A pending citation in the composer: shows the full passage as selectable text so the
 * agent can highlight words/sentences in a color before sending. Highlights are stored
 * as character ranges on the citation and travel with the message.
 */
export function CitationEditor({
  citation,
  onChange,
  onRemove,
}: {
  citation: KbCitation;
  onChange: (next: KbCitation) => void;
  onRemove: () => void;
}) {
  const passageRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const len = citation.passage.length;

  /** Snapshot the current text selection (if inside the passage) as passage offsets. */
  function capture() {
    const container = passageRef.current;
    const selection = window.getSelection();
    if (container === null || selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
      setSel(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      setSel(null);
      return;
    }
    const a = offsetWithin(container, range.startContainer, range.startOffset);
    const b = offsetWithin(container, range.endContainer, range.endOffset);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    setSel(end > start ? { start, end } : null);
  }

  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  }

  function paint(color: HighlightColor) {
    if (sel === null) return;
    onChange({ ...citation, highlights: applyHighlight(citation.highlights, sel.start, sel.end, color, len) });
    clearSelection();
  }

  function erase() {
    if (sel === null) return;
    onChange({ ...citation, highlights: eraseHighlight(citation.highlights, sel.start, sel.end, len) });
    clearSelection();
  }

  function clearAll() {
    onChange({ ...citation, highlights: [] });
    clearSelection();
  }

  const hasHighlights = (citation.highlights?.length ?? 0) > 0;
  const active = sel !== null;

  return (
    <div className="rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[12px]">
      <div className="flex items-start gap-2">
        <IconBook size={13} className="mt-0.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-medium">{citation.title}</span>
        <Tooltip label="Remove citation">
          <button
            type="button"
            aria-label={`Remove citation ${citation.title}`}
            onClick={onRemove}
            className="shrink-0 rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-3 hover:text-text"
          >
            <IconX size={12} />
          </button>
        </Tooltip>
      </div>
      <div
        ref={passageRef}
        onMouseUp={capture}
        onKeyUp={capture}
        className="mt-1.5 max-h-32 cursor-text select-text overflow-y-auto rounded-sm bg-surface px-2 py-1.5 text-[13px] leading-relaxed text-text-2"
      >
        <CitationPassage passage={citation.passage} highlights={citation.highlights} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[11px] text-text-3">{active ? 'Highlight:' : 'Select text to highlight'}</span>
        {HIGHLIGHT_COLORS.map((color) => (
          <Tooltip key={color} label={`Highlight ${HIGHLIGHT_LABELS[color]}`}>
            <button
              type="button"
              disabled={!active}
              aria-label={`Highlight selection ${HIGHLIGHT_LABELS[color]}`}
              // Keep the text selection alive through the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => paint(color)}
              style={{ background: `var(--hl-${color})` }}
              className="h-4 w-4 rounded-full border border-line-2 transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            />
          </Tooltip>
        ))}
        <Tooltip label="Remove highlight from selection">
          <button
            type="button"
            disabled={!active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={erase}
            className={cx(
              'rounded-sm px-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              'text-text-3 hover:bg-surface-3 hover:text-text',
            )}
          >
            Erase
          </button>
        </Tooltip>
        <div className="flex-1" />
        {hasHighlights && (
          <button type="button" onClick={clearAll} className="text-[11px] text-text-3 transition-colors hover:text-text">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
