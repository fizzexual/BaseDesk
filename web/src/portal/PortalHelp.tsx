import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router';
import { portalApi } from './api';
import { btnPrimary } from './ui';
import { EmptyState } from '../components/EmptyState';
import { TimeAgo } from '../components/TimeAgo';
import { cx } from '../components/util';
import type { KbArticle } from '../data/types';
import { IconBook, IconChevronLeft, IconChevronRight, IconSearch, IconTicket } from '../icons';

// The help center is a small documentation site: a category sidebar, a searchable
// landing, and article pages with breadcrumbs and prev/next. The layout route
// loads every published article once and shares it (plus the search box) with its
// child routes through the outlet context.

type HelpContext = {
  articles: KbArticle[];
  loading: boolean;
  query: string;
  setQuery: (q: string) => void;
  categories: string[]; // in first-seen order (Getting started stays first)
  byCategory: Map<string, KbArticle[]>;
  ordered: KbArticle[]; // flattened in sidebar order, for prev/next
};

function useHelp(): HelpContext {
  return useOutletContext<HelpContext>();
}

// A "getting started"-style category is pinned to the top; everything else is
// alphabetical — the ordering readers expect from documentation.
const INTRO_CATEGORY = /get(ting)? started|introduction|getting set up|basics|overview/i;

/** Group articles by category, then order both categories and articles for docs. */
function buildIndex(articles: KbArticle[]) {
  const byCategory = new Map<string, KbArticle[]>();
  for (const a of articles) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }
  for (const list of byCategory.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  const categories = [...byCategory.keys()].sort((a, b) => {
    const ia = INTRO_CATEGORY.test(a);
    const ib = INTRO_CATEGORY.test(b);
    if (ia !== ib) return ia ? -1 : 1;
    return a.localeCompare(b);
  });
  const ordered = categories.flatMap((c) => byCategory.get(c) ?? []);
  return { categories, byCategory, ordered };
}

const matches = (a: KbArticle, q: string) => q === '' || `${a.title} ${a.body}`.toLowerCase().includes(q);

export function HelpLayout() {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    portalApi
      .kb()
      .then(setArticles)
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, []);

  const { categories, byCategory, ordered } = useMemo(() => buildIndex(articles), [articles]);
  const ctx: HelpContext = { articles, loading, query, setQuery, categories, byCategory, ordered };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px]">
      <DocsSidebar ctx={ctx} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

function DocsSidebar({ ctx }: { ctx: HelpContext }) {
  const { slug } = useParams();
  const q = ctx.query.trim().toLowerCase();

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col border-r border-line lg:flex">
      <div className="shrink-0 border-b border-line p-3">
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={ctx.query}
            onChange={(e) => ctx.setQuery(e.target.value)}
            placeholder="Search docs…"
            aria-label="Search documentation"
            className="h-9 w-full rounded-md border border-line bg-bg pl-8 pr-3 text-[13px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        <Link
          to="/portal/help"
          className={cx(
            'mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
            slug === undefined ? 'bg-surface-2 text-text' : 'text-text-2 hover:bg-surface-2/60 hover:text-text',
          )}
        >
          <IconBook size={15} className="shrink-0" />
          Overview
        </Link>
        {ctx.categories.map((cat) => {
          const list = ctx.byCategory.get(cat)?.filter((a) => matches(a, q)) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={cat} className="mb-4">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">{cat}</div>
              <ul className="flex flex-col">
                {list.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/portal/help/${a.slug}`}
                      aria-current={a.slug === slug ? 'page' : undefined}
                      className={cx(
                        'block rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors',
                        a.slug === slug ? 'bg-surface-2 font-medium text-text' : 'text-text-2 hover:bg-surface-2/60 hover:text-text',
                      )}
                    >
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

/** A search-result / category-card row linking to an article. */
function ArticleRow({ article }: { article: KbArticle }) {
  return (
    <Link
      to={`/portal/help/${article.slug}`}
      className="flex items-center gap-2 text-[13px] text-text-2 transition-colors hover:text-accent"
    >
      <IconChevronRight size={13} className="shrink-0 text-text-3" />
      <span className="truncate">{article.title}</span>
    </Link>
  );
}

export function HelpIndex() {
  const ctx = useHelp();
  const q = ctx.query.trim().toLowerCase();
  const results = q === '' ? null : ctx.ordered.filter((a) => matches(a, q));

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-10 sm:px-8">
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <IconBook size={24} />
        </div>
        <h1 className="mt-4 text-[26px] font-semibold tracking-tight">How can we help?</h1>
        <p className="mt-1.5 text-[14px] text-text-3">Search the documentation or browse by topic.</p>
        <div className="relative mx-auto mt-5 max-w-[520px]">
          <IconSearch size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={ctx.query}
            onChange={(e) => ctx.setQuery(e.target.value)}
            placeholder="Search for answers…"
            aria-label="Search documentation"
            className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-3 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
        </div>
      </div>

      {ctx.loading ? (
        <p className="mt-10 text-center text-[13px] text-text-3">Loading…</p>
      ) : ctx.articles.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={IconBook} title="Nothing here yet" hint="Help articles will appear here as they're published." />
        </div>
      ) : results !== null ? (
        <div className="mt-8">
          <p className="mb-3 text-[12px] text-text-3">
            {results.length} result{results.length === 1 ? '' : 's'} for “{ctx.query.trim()}”
          </p>
          {results.length === 0 ? (
            <EmptyState icon={IconSearch} title="No matches" hint="Try different or more general keywords." />
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {results.map((a) => (
                <li key={a.id}>
                  <Link to={`/portal/help/${a.slug}`} className="block px-4 py-3 transition-colors hover:bg-surface-2">
                    <div className="text-[14px] font-medium">{a.title}</div>
                    <div className="mt-0.5 line-clamp-1 text-[12px] text-text-3">{a.category} · {a.body}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-9 grid gap-4 sm:grid-cols-2">
          {ctx.categories.map((cat) => {
            const list = ctx.byCategory.get(cat) ?? [];
            return (
              <div key={cat} className="rounded-xl border border-line bg-surface p-5">
                <h2 className="text-[15px] font-semibold">{cat}</h2>
                <p className="mt-0.5 text-[12px] text-text-3">
                  {list.length} article{list.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {list.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <ArticleRow article={a} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PrevNext({ dir, article }: { dir: 'prev' | 'next'; article: KbArticle }) {
  const isPrev = dir === 'prev';
  return (
    <Link
      to={`/portal/help/${article.slug}`}
      className={cx(
        'group flex flex-col gap-1 rounded-lg border border-line p-3 transition-colors hover:border-line-2 hover:bg-surface-2/50',
        isPrev ? 'items-start text-left' : 'items-end text-right',
      )}
    >
      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-text-3">
        {isPrev && <IconChevronLeft size={12} />}
        {isPrev ? 'Previous' : 'Next'}
        {!isPrev && <IconChevronRight size={12} />}
      </span>
      <span className="text-[13px] font-medium text-text-2 group-hover:text-text">{article.title}</span>
    </Link>
  );
}

export function HelpArticle() {
  const ctx = useHelp();
  const { slug } = useParams();
  const idx = ctx.ordered.findIndex((a) => a.slug === slug);
  const article = idx >= 0 ? ctx.ordered[idx] : null;

  if (ctx.loading) {
    return <p className="p-10 text-center text-[13px] text-text-3">Loading…</p>;
  }
  if (article === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <p className="text-[14px] text-text-2">That article doesn’t exist.</p>
        <Link to="/portal/help" className="mt-2 text-[13px] font-medium text-accent hover:underline">
          Back to the help center
        </Link>
      </div>
    );
  }

  const prev = idx > 0 ? ctx.ordered[idx - 1] : null;
  const next = idx < ctx.ordered.length - 1 ? ctx.ordered[idx + 1] : null;
  const paragraphs = article.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-10 sm:px-8">
      <nav className="flex items-center gap-1.5 text-[12px] text-text-3">
        <Link to="/portal/help" className="transition-colors hover:text-text">
          Help center
        </Link>
        <IconChevronRight size={12} className="shrink-0" />
        <span className="text-text-2">{article.category}</span>
      </nav>

      <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">{article.title}</h1>
      <p className="mt-2 text-[12px] text-text-3">
        Updated <TimeAgo iso={article.updatedAt} />
      </p>

      <article className="mt-6 flex flex-col gap-4 text-[15px] leading-7 text-text-2">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </article>

      <div className="mt-10 flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-6 text-center">
        <p className="text-[14px] font-medium">Still need a hand?</p>
        <p className="text-[13px] text-text-3">If this didn’t answer your question, our team is happy to help.</p>
        <Link to="/portal/new" className={cx(btnPrimary, 'mt-2')}>
          <IconTicket size={15} />
          Contact support
        </Link>
      </div>

      {(prev || next) && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {prev ? <PrevNext dir="prev" article={prev} /> : <div className="hidden sm:block" />}
          {next ? <PrevNext dir="next" article={next} /> : <div className="hidden sm:block" />}
        </div>
      )}
    </div>
  );
}
