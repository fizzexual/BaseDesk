import { useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useApp } from '../../data/store';
import type { ArticleStatus, KbArticle } from '../../data/types';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconBook, IconDots, IconPlus, IconSearch, IconTrash } from '../../icons';
import { KbEditor } from './KbEditor';

function StatusBadge({ status }: { status: ArticleStatus }) {
  const style =
    status === 'published' ? 'bg-green-bg text-green' : 'bg-surface-2 text-text-3';
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium', style)}>
      {status === 'published' ? 'Published' : 'Draft'}
    </span>
  );
}

function Reader({
  article,
  onEdit,
  onDelete,
}: {
  article: KbArticle;
  onEdit: (article: KbArticle) => void;
  onDelete: (article: KbArticle) => void;
}) {
  const paragraphs = useMemo(
    () =>
      article.body
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p !== ''),
    [article.body],
  );

  return (
    <article className="mx-auto max-w-[720px] p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-text-3">{article.category}</div>
          <h1 className="mt-1 text-[24px] font-semibold leading-tight">{article.title}</h1>
          <div className="mt-2.5 flex items-center gap-2.5">
            <StatusBadge status={article.status} />
            <span className="flex items-center gap-1 text-[13px] text-text-3">
              Updated <TimeAgo iso={article.updatedAt} />
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="subtle" size="sm" onClick={() => onEdit(article)}>
            Edit
          </Button>
          <Menu
            align="end"
            triggerLabel="Article actions"
            triggerClassName="inline-flex size-8 items-center justify-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            trigger={<IconDots size={16} />}
            items={[
              {
                label: 'Delete',
                icon: <IconTrash size={15} />,
                danger: true,
                onSelect: () => onDelete(article),
              },
            ]}
          />
        </div>
      </div>
      {paragraphs.length === 0 ? (
        <p className="text-[15px] text-text-3">No content yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-line text-[15px] leading-relaxed text-text">
              {p}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

export function KbPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const kb = useApp((s) => s.kb);
  const deleteArticle = useApp((s) => s.deleteArticle);

  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KbArticle | undefined>(undefined);

  const total = Object.keys(kb).length;
  const article = id !== undefined ? kb[id] : undefined;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = Object.values(kb).filter((a) => {
      if (q === '') return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q)
      );
    });
    const byCategory = new Map<string, KbArticle[]>();
    for (const a of filtered) {
      const list = byCategory.get(a.category) ?? [];
      list.push(a);
      byCategory.set(a.category, list);
    }
    return [...byCategory.entries()]
      .map(([category, articles]) => ({
        category,
        articles: articles.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [kb, query]);

  function openNew() {
    setEditing(undefined);
    setEditorOpen(true);
  }

  function openEdit(a: KbArticle) {
    setEditing(a);
    setEditorOpen(true);
  }

  async function removeArticle(a: KbArticle) {
    try {
      await deleteArticle(a.id);
      toast('Article deleted');
      navigate('/kb');
    } catch {
      toast('Could not delete the article');
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-line">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
          <h1 className="text-[15px] font-semibold">Knowledge base</h1>
          <div className="flex-1" />
          <Button variant="primary" size="sm" onClick={openNew}>
            <IconPlus size={15} />
            New
          </Button>
        </div>

        <div className="shrink-0 border-b border-line p-2">
          <div className="relative">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
            />
            <input
              value={query}
              aria-label="Search articles"
              placeholder="Search articles"
              className="h-8 w-full rounded-md border border-line bg-bg pl-8 pr-2.5 text-[13px] outline-none focus:border-line-2"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {total === 0 ? (
            <EmptyState icon={IconBook} title="No articles yet" hint="Create your first help article." />
          ) : groups.length === 0 ? (
            <div className="px-2 py-8 text-center text-[13px] text-text-3">No matches</div>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  {group.category}
                </div>
                {group.articles.map((a) => (
                  <NavLink
                    key={a.id}
                    to={`/kb/${a.id}`}
                    className={({ isActive }) =>
                      cx(
                        'flex h-9 items-center gap-2 rounded-md px-2 transition-colors',
                        isActive
                          ? 'bg-surface-3 text-text'
                          : 'text-text-2 hover:bg-surface-2 hover:text-text',
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px]">{a.title}</span>
                    {a.status === 'draft' && (
                      <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
                        Draft
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {article !== undefined ? (
          <Reader article={article} onEdit={openEdit} onDelete={removeArticle} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={IconBook}
              title="Select an article"
              hint="Pick an article on the left, or create a new one."
            />
          </div>
        )}
      </div>

      {editorOpen && (
        <KbEditor
          key={editing ? editing.id : 'new'}
          open
          onClose={() => setEditorOpen(false)}
          article={editing}
        />
      )}
    </div>
  );
}
