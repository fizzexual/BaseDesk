import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { ArticleStatus, KbArticle } from '../../data/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { Markdown } from './Markdown';

const FIELD = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2';
const LABEL = 'mb-1.5 block text-[13px] font-medium text-text-2';

const STATUS_OPTIONS: { value: ArticleStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

export function KbEditor({
  open,
  onClose,
  article,
}: {
  open: boolean;
  onClose: () => void;
  article?: KbArticle;
}) {
  const navigate = useNavigate();
  const kb = useApp((s) => s.kb);
  const createArticle = useApp((s) => s.createArticle);
  const updateArticle = useApp((s) => s.updateArticle);
  const deleteArticle = useApp((s) => s.deleteArticle);

  const editing = article !== undefined;

  const [title, setTitle] = useState(article?.title ?? '');
  const [category, setCategory] = useState(article?.category ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [status, setStatus] = useState<ArticleStatus>(article?.status ?? 'draft');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bodyView, setBodyView] = useState<'write' | 'preview'>('write');

  const categories = useMemo(
    () => [...new Set(Object.values(kb).map((a) => a.category))].sort((a, b) => a.localeCompare(b)),
    [kb],
  );

  const valid = title.trim() !== '' && category.trim() !== '';

  async function save() {
    if (!valid) return;
    try {
      if (editing) {
        await updateArticle(article.id, {
          title: title.trim(),
          category: category.trim(),
          body,
          status,
        });
        toast('Article saved');
        onClose();
      } else {
        const id = await createArticle({
          title: title.trim(),
          category: category.trim(),
          body,
          status,
        });
        toast('Article created');
        onClose();
        navigate(`/kb/${id}`);
      }
    } catch {
      toast('Could not save the article');
    }
  }

  async function remove() {
    if (!editing) return;
    try {
      await deleteArticle(article.id);
      toast('Article deleted');
      onClose();
      navigate('/kb');
    } catch {
      toast('Could not delete the article');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit article' : 'New article'} width={560}>
      <div className="flex flex-col gap-3.5">
        <div>
          <label className={LABEL} htmlFor="kb-title">Title</label>
          <input
            id="kb-title"
            className={FIELD}
            placeholder="How to reset your password"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="kb-category">Category</label>
          <input
            id="kb-category"
            className={FIELD}
            list="kb-categories"
            placeholder="Getting started"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="kb-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[13px] font-medium text-text-2" htmlFor="kb-body">Body</label>
            <div className="flex rounded-md border border-line p-0.5 text-[12px] font-medium">
              {(['write', 'preview'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBodyView(v)}
                  className={cx('rounded px-2 py-0.5 capitalize transition-colors', bodyView === v ? 'bg-surface-2 text-text' : 'text-text-3 hover:text-text')}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {bodyView === 'write' ? (
            <textarea
              id="kb-body"
              className="min-h-64 w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-line-2"
              placeholder={'Write in Markdown…\n\n# Heading\n**Bold**, *italic*, `code`, [links](https://…)\n\n- a list\n- of items\n\n| Column | Value |\n| --- | --- |\n| Row | 1 |'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          ) : (
            <div className="min-h-64 max-h-[46vh] overflow-auto rounded-md border border-line bg-bg px-3.5 py-2">
              {body.trim() === '' ? <p className="text-[13px] text-text-3">Nothing to preview yet.</p> : <Markdown text={body} />}
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-text-3">
            Markdown supported — headings, <strong className="font-semibold text-text-2">bold</strong>, lists, tables, links, and{' '}
            <code className="rounded bg-surface-3 px-1 font-mono text-[0.9em]">code</code>.
          </p>
        </div>

        <div>
          <span className={LABEL}>
            <Tooltip
              title="Status"
              label="Draft stays private while you write. Published makes it live so the AI assistant can match and use it in replies."
            >
              <span>Status</span>
            </Tooltip>
          </span>
          <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        </div>

        <div className="mt-1 flex items-center justify-between">
          {editing ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-[13px] text-text-2">
                Delete?
                <button type="button" className="font-medium text-red hover:underline" onClick={remove}>Yes</button>
                <button type="button" className="text-text-3 hover:text-text" onClick={() => setConfirmDelete(false)}>No</button>
              </span>
            ) : (
              <button
                type="button"
                className="text-[13px] font-medium text-red hover:underline"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!valid} onClick={save}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
