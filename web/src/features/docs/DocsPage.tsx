import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DOCS, DOC_CATEGORIES, type DocArticle } from './content';
import { DocBody } from './examples';
import { cx } from '../../components/util';
import { IconBook, IconChevronLeft, IconChevronRight, IconSearch } from '../../icons';

// The System Guide reader. Content is static (see content.ts) and read-only —
// this documents BaseDesk itself, so there's no editing, publishing, or storage.

/** Articles flattened in category → in-file order, for prev/next. */
const ORDERED: DocArticle[] = DOC_CATEGORIES.flatMap((cat) => DOCS.filter((d) => d.category === cat));
const matches = (d: DocArticle, q: string) => q === '' || `${d.title} ${d.summary} ${d.body}`.toLowerCase().includes(q);

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-text-3">
      Built-in · read-only
    </span>
  );
}

function Sidebar({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const { slug } = useParams();
  const query = q.trim().toLowerCase();
  return (
    <aside className="hidden w-[280px] shrink-0 flex-col border-r border-line lg:flex">
      <div className="shrink-0 border-b border-line p-3">
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the guide…"
            aria-label="Search the guide"
            className="h-9 w-full rounded-md border border-line bg-bg pl-8 pr-3 text-[13px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        <Link
          to="/docs"
          className={cx(
            'mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
            slug === undefined ? 'bg-surface-2 text-text' : 'text-text-2 hover:bg-surface-2/60 hover:text-text',
          )}
        >
          <IconBook size={15} className="shrink-0" />
          Overview
        </Link>
        {DOC_CATEGORIES.map((cat) => {
          const list = DOCS.filter((d) => d.category === cat && matches(d, query));
          if (list.length === 0) return null;
          return (
            <div key={cat} className="mb-4">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">{cat}</div>
              <ul className="flex flex-col">
                {list.map((d) => (
                  <li key={d.slug}>
                    <Link
                      to={`/docs/${d.slug}`}
                      aria-current={d.slug === slug ? 'page' : undefined}
                      className={cx(
                        'block rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors',
                        d.slug === slug ? 'bg-surface-2 font-medium text-text' : 'text-text-2 hover:bg-surface-2/60 hover:text-text',
                      )}
                    >
                      {d.title}
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

function Landing() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-10">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <IconBook size={22} />
        </div>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">System Guide</h1>
          <p className="mt-0.5 text-[13px] text-text-3">How every part of BaseDesk works — built in and always current.</p>
        </div>
        <div className="flex-1" />
        <ReadOnlyBadge />
      </div>
      <p className="mt-6 text-[14px] leading-relaxed text-text-2">
        This is the built-in reference for BaseDesk itself. It ships with the app and can’t be edited, so it always
        describes the version you’re running. (For your own customer-facing help articles, use the Knowledge base.)
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {DOC_CATEGORIES.map((cat) => {
          const list = DOCS.filter((d) => d.category === cat);
          if (list.length === 0) return null;
          return (
            <div key={cat} className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-[15px] font-semibold">{cat}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {list.map((d) => (
                  <li key={d.slug}>
                    <Link to={`/docs/${d.slug}`} className="flex items-center gap-2 text-[13px] text-text-2 transition-colors hover:text-accent">
                      <IconChevronRight size={13} className="shrink-0 text-text-3" />
                      <span className="truncate">{d.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrevNext({ dir, article }: { dir: 'prev' | 'next'; article: DocArticle }) {
  const isPrev = dir === 'prev';
  return (
    <Link
      to={`/docs/${article.slug}`}
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

function Article({ article }: { article: DocArticle }) {
  const idx = ORDERED.findIndex((d) => d.slug === article.slug);
  const prev = idx > 0 ? ORDERED[idx - 1] : null;
  const next = idx < ORDERED.length - 1 ? ORDERED[idx + 1] : null;
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-10">
      <nav className="flex items-center gap-1.5 text-[12px] text-text-3">
        <Link to="/docs" className="transition-colors hover:text-text">System Guide</Link>
        <IconChevronRight size={12} className="shrink-0" />
        <span className="text-text-2">{article.category}</span>
        <span className="flex-1" />
        <ReadOnlyBadge />
      </nav>
      <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight">{article.title}</h1>
      <p className="mt-1.5 text-[14px] text-text-3">{article.summary}</p>
      <article className="mt-6">
        <DocBody text={article.body} />
      </article>
      {(prev || next) && (
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {prev ? <PrevNext dir="prev" article={prev} /> : <div className="hidden sm:block" />}
          {next ? <PrevNext dir="next" article={next} /> : <div className="hidden sm:block" />}
        </div>
      )}
    </div>
  );
}

export function DocsPage() {
  const { slug } = useParams();
  const [q, setQ] = useState('');
  const article = useMemo(() => (slug !== undefined ? DOCS.find((d) => d.slug === slug) : undefined), [slug]);

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar q={q} setQ={setQ} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {slug !== undefined && article === undefined ? (
          <div className="mx-auto w-full max-w-[760px] px-6 py-16 text-center">
            <p className="text-[14px] text-text-2">That guide page doesn’t exist.</p>
            <Link to="/docs" className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
              Back to the System Guide
            </Link>
          </div>
        ) : article !== undefined ? (
          <Article article={article} />
        ) : (
          <Landing />
        )}
      </div>
    </div>
  );
}
