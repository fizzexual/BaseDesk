import { useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { useApp } from '../../data/store';
import type { KbArticle, KbCitation } from '../../data/types';
import { IconBook, IconChevronLeft, IconSearch } from '../../icons';

/** Article body split into readable passages (blank-line separated), whitespace collapsed. */
function passages(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Build the structured citation embed attached to the reply for a picked passage. */
function toCitation(article: KbArticle, passage: string): KbCitation {
  return {
    type: 'kb_citation',
    articleId: article.id,
    title: article.title,
    category: article.category.trim() === '' ? null : article.category,
    slug: article.slug,
    passage,
  };
}

const ROW = 'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2';

export function KbQuoteDialog({ onClose, onCite }: { onClose: () => void; onCite: (citation: KbCitation) => void }) {
  const kb = useApp((s) => s.kb);
  const [q, setQ] = useState('');
  const [article, setArticle] = useState<KbArticle | null>(null);

  const published = useMemo(() => Object.values(kb).filter((a) => a.status === 'published'), [kb]);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return published
      .filter((a) => term === '' || `${a.title} ${a.category ?? ''} ${a.body}`.toLowerCase().includes(term))
      .slice(0, 20);
  }, [published, q]);
  const paras = useMemo(() => (article ? passages(article.body) : []), [article]);

  return (
    <Dialog open onClose={onClose} title={article ? 'Attach a citation' : 'Cite a help article'} width={560}>
      {article === null ? (
        <>
          <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3">
            <IconSearch size={15} className="shrink-0 text-text-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search published articles…"
              className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-text-3"
            />
          </div>
          <ul className="mt-3 max-h-[320px] overflow-y-auto">
            {results.length === 0 ? (
              <li>
                <EmptyState icon={<IconBook size={26} />} title="No matching articles" hint="Only published articles can be cited." />
              </li>
            ) : (
              results.map((a) => (
                <li key={a.id}>
                  <button type="button" className={ROW} onClick={() => setArticle(a)}>
                    <IconBook size={15} className="mt-0.5 shrink-0 text-text-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{a.title}</span>
                      {a.category && <span className="block truncate text-[12px] text-text-3">{a.category}</span>}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setArticle(null)} className="inline-flex items-center gap-1 text-[13px] font-medium text-text-2 transition-colors hover:text-text">
            <IconChevronLeft size={15} />
            All articles
          </button>
          <h3 className="mt-2 text-[15px] font-semibold">{article.title}</h3>
          <p className="mt-0.5 text-[12px] text-text-3">Pick a passage to attach as a citation to your reply.</p>
          <ul className="mt-3 max-h-[320px] space-y-1 overflow-y-auto">
            {paras.map((p, i) => (
              <li key={i}>
                <button type="button" className={`${ROW} text-[13px] leading-relaxed text-text-2`} onClick={() => onCite(toCitation(article, p))}>
                  {p.length > 240 ? `${p.slice(0, 240)}…` : p}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
