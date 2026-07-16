import type { ReactNode } from 'react';
import { cx } from '../../components/util';

// Self-contained Markdown → React renderer (no dependency, matching BaseDesk's hand-rolled style).
// Supports: headings, bold/italic/inline-code/links, unordered & ordered lists, blockquotes,
// fenced code blocks, GFM tables (with alignment), and horizontal rules.

const LINK = 'font-medium text-accent underline decoration-line-2 underline-offset-2 transition-colors hover:decoration-accent';
const HEADING = [
  '',
  'text-[24px] font-semibold mt-8 mb-3',
  'text-[20px] font-semibold mt-7 mb-2.5',
  'text-[17px] font-semibold mt-6 mb-2',
  'text-[15px] font-semibold mt-5 mb-1.5',
  'text-[14px] font-semibold mt-4 mb-1',
  'text-[13px] font-semibold mt-4 mb-1',
];

/** Inline spans: `code`, **bold**, *italic*, [text](url). Text is space-joined, so no newlines here. */
function inline(text: string, kp: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*.+?\*\*)|(__.+?__)|(\*[^*]+?\*)|(_[^_]+?_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${kp}-${n++}`;
    if (t[0] === '`') {
      out.push(<code key={k} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    } else if (t.startsWith('**') || t.startsWith('__')) {
      out.push(<strong key={k} className="font-semibold">{inline(t.slice(2, -2), k)}</strong>);
    } else if (t[0] === '[') {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t);
      out.push(lm ? <a key={k} href={lm[2]} target="_blank" rel="noreferrer noopener" className={LINK}>{lm[1]}</a> : t);
    } else {
      out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Split a table row on unescaped pipes, trimming the optional outer pipes. */
function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.trim());
}

const isSeparator = (s: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes('-');
type Align = 'left' | 'right' | 'center';
const alignOf = (c: string): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');

/** Flatten Markdown to a plain string — for one-line previews, snippets and search results. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s{0,3}>\s?/gm, '') // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '') // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered list markers
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // drop table rows entirely
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, ' ') // horizontal rules
    .replace(/\*\*|__|~~/g, '') // bold / strikethrough markers
    .replace(/\s+/g, ' ')
    .trim();
}

export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/g, '\n').replace(/\t/g, '    ').split('\n');
  const out: ReactNode[] = [];
  let key = 0;
  const K = () => `md-${key++}`;

  const isBlockStart = (idx: number): boolean => {
    const l = lines[idx];
    return (
      l.trim() === '' ||
      /^\s*```/.test(l) ||
      /^#{1,6}\s/.test(l) ||
      /^\s*([-*_])\1{2,}\s*$/.test(l) ||
      /^\s*>\s?/.test(l) ||
      /^\s*[-*+]\s+/.test(l) ||
      /^\s*\d+\.\s+/.test(l) ||
      (l.includes('|') && idx + 1 < lines.length && isSeparator(lines[idx + 1]))
    );
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // closing fence
      out.push(
        <pre key={K()} className="my-3 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-text-2">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const Tag = `h${Math.min(lvl, 6)}` as 'h1';
      out.push(<Tag key={K()} className={cx('leading-tight', HEADING[lvl])}>{inline(h[2].trim(), K())}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={K()} className="my-6 border-line" />);
      i++;
      continue;
    }

    // GFM table
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(line);
      const aligns = cells(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(cells(lines[i])); i++; }
      out.push(
        <div key={K()} className="my-4 overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-surface-2">
                {header.map((c, ci) => (
                  <th key={ci} style={{ textAlign: aligns[ci] ?? 'left' }} className="border-b border-line px-3 py-2 font-semibold">
                    {inline(c, K())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line first:border-t-0">
                  {header.map((_, ci) => (
                    <td key={ci} style={{ textAlign: aligns[ci] ?? 'left' }} className="px-3 py-2 text-text-2">
                      {inline(r[ci] ?? '', K())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(
        <blockquote key={K()} className="my-4 border-l-[3px] border-accent pl-4 text-text-2 italic">
          {inline(q.join(' '), K())}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      out.push(
        <ul key={K()} className="my-3 ml-5 flex list-disc flex-col gap-1.5 marker:text-text-3">
          {items.map((it, ii) => <li key={ii} className="pl-1 leading-relaxed">{inline(it, K())}</li>)}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push(
        <ol key={K()} className="my-3 ml-5 flex list-decimal flex-col gap-1.5 marker:text-text-3">
          {items.map((it, ii) => <li key={ii} className="pl-1 leading-relaxed">{inline(it, K())}</li>)}
        </ol>,
      );
      continue;
    }

    // Paragraph — gather soft-wrapped lines until the next block
    const para: string[] = [];
    while (i < lines.length && !isBlockStart(i)) { para.push(lines[i]); i++; }
    if (para.length > 0) out.push(<p key={K()} className="my-3 leading-relaxed">{inline(para.join(' '), K())}</p>);
  }

  return <div className="text-[15px] text-text">{out}</div>;
}
