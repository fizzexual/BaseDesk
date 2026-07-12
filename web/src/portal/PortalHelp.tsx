import { useEffect, useMemo, useState } from 'react';
import { portalApi } from './api';
import { EmptyState } from '../components/EmptyState';
import type { KbArticle } from '../data/types';
import { IconBook, IconSearch } from '../icons';

export function PortalHelp() {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi
      .kb()
      .then(setArticles)
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q === '' ? articles : articles.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(q));
    const byCategory = new Map<string, KbArticle[]>();
    for (const a of filtered) {
      const list = byCategory.get(a.category) ?? [];
      list.push(a);
      byCategory.set(a.category, list);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [articles, query]);

  return (
    <section>
      <h1 className="text-[20px] font-semibold">Help center</h1>
      <p className="mt-1 text-[13px] text-text-3">Browse answers to common questions.</p>

      <div className="relative mt-5">
        <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles…"
          className="h-10 w-full rounded-md border border-line bg-bg pl-9 pr-3 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3"
        />
      </div>

      {loading ? (
        <p className="mt-6 text-[13px] text-text-3">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={IconBook} title="Nothing here yet" hint="Help articles will appear here as they're published." />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map(([category, list]) => (
            <div key={category}>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">{category}</h2>
              <div className="flex flex-col gap-2">
                {list.map((a) => (
                  <details key={a.id} className="group rounded-lg border border-line bg-surface">
                    <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium marker:content-none">
                      {a.title}
                    </summary>
                    <div className="whitespace-pre-wrap border-t border-line px-4 py-3 text-[14px] leading-relaxed text-text-2">
                      {a.body}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
