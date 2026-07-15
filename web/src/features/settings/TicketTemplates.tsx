import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { useApp } from '../../data/store';
import type { TicketPriority } from '../../data/types';
import { IconDots, IconNote, IconPlus, IconTag, IconTicket, IconTrash } from '../../icons';

interface EditorState {
  id: string | null;
  name: string;
  subject: string;
  body: string;
  priority: TicketPriority;
  category: string;
  tags: string;
}

const PRIORITY_OPTIONS: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const FIELD = 'mt-1.5 h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-[14px]';
const BLANK: EditorState = { id: null, name: '', subject: '', body: '', priority: 'medium', category: '', tags: '' };

function parseTags(raw: string): string[] {
  return [...new Set(raw.split(',').map((t) => t.trim()).filter((t) => t !== ''))];
}

export function TicketTemplates() {
  const templates = useApp((s) => s.templates);
  const categories = useApp((s) => s.categories);
  const saveTemplate = useApp((s) => s.saveTemplate);
  const deleteTemplate = useApp((s) => s.deleteTemplate);
  const [editor, setEditor] = useState<EditorState | null>(null);

  async function onSave() {
    if (!editor) return;
    const name = editor.name.trim();
    if (name === '') return;
    try {
      await saveTemplate({
        id: editor.id ?? '',
        name,
        subject: editor.subject,
        body: editor.body,
        priority: editor.priority,
        category: editor.category.trim() === '' ? null : editor.category.trim(),
        tags: parseTags(editor.tags),
      });
      setEditor(null);
    } catch {
      toast('Could not save the template');
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteTemplate(id);
      toast('Template deleted');
    } catch {
      toast('Could not delete the template');
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">
          <Tooltip
            title="Ticket templates"
            label="Reusable starting points for new tickets — prefill the subject, message, priority, category and tags in one click."
          >
            Ticket templates
          </Tooltip>
        </h2>
        <Button variant="subtle" size="sm" onClick={() => setEditor({ ...BLANK })}>
          <IconPlus size={15} />
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={IconTicket}
          title="No templates yet"
          hint="Create templates for the requests you handle most — bug reports, refunds, feature requests — and start new tickets from them."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-md border border-line p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{t.name}</span>
                  <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium capitalize text-text-2">
                    {t.priority}
                  </span>
                </div>
                <div className="truncate text-[13px] text-text-3">
                  {t.subject.trim() !== '' ? t.subject : t.body.split('\n')[0] || 'No subject'}
                </div>
                {(t.category !== null || t.tags.length > 0) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
                    {t.category !== null && (
                      <span className="inline-flex items-center gap-1">
                        <IconTag size={11} />
                        {t.category}
                      </span>
                    )}
                    {t.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-surface-2 px-1.5 py-0.5">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Menu
                align="end"
                triggerLabel={`Actions for ${t.name}`}
                triggerClassName="size-7 shrink-0 justify-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                trigger={<IconDots size={16} />}
                items={[
                  {
                    label: 'Edit',
                    icon: <IconNote size={15} />,
                    onSelect: () =>
                      setEditor({
                        id: t.id,
                        name: t.name,
                        subject: t.subject,
                        body: t.body,
                        priority: t.priority,
                        category: t.category ?? '',
                        tags: t.tags.join(', '),
                      }),
                  },
                  { label: 'Delete', icon: <IconTrash size={15} />, danger: true, onSelect: () => void onDelete(t.id) },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <Dialog open={editor !== null} onClose={() => setEditor(null)} title={editor?.id ? 'Edit template' : 'New template'} width={520}>
        {editor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <label className="block text-[13px] font-medium" htmlFor="tpl-name">
              Template name
            </label>
            <input
              id="tpl-name"
              type="text"
              value={editor.name}
              placeholder="Bug report"
              className={FIELD}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium" htmlFor="tpl-priority">
                  Priority
                </label>
                <select
                  id="tpl-priority"
                  value={editor.priority}
                  className={`${FIELD} capitalize`}
                  onChange={(e) => setEditor({ ...editor, priority: e.target.value as TicketPriority })}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium" htmlFor="tpl-category">
                  Category
                </label>
                <select
                  id="tpl-category"
                  value={editor.category}
                  className={FIELD}
                  onChange={(e) => setEditor({ ...editor, category: e.target.value })}
                >
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  {/* Keep a saved category that's no longer offered by the intake form selectable. */}
                  {editor.category !== '' && !categories.includes(editor.category) && (
                    <option value={editor.category}>{editor.category}</option>
                  )}
                </select>
              </div>
            </div>

            <label className="mt-4 block text-[13px] font-medium" htmlFor="tpl-subject">
              Subject <span className="font-normal text-text-3">(optional prefill)</span>
            </label>
            <input
              id="tpl-subject"
              type="text"
              value={editor.subject}
              placeholder="Leave blank to let the agent write it"
              className={FIELD}
              onChange={(e) => setEditor({ ...editor, subject: e.target.value })}
            />

            <label className="mt-4 block text-[13px] font-medium" htmlFor="tpl-body">
              Message
            </label>
            <textarea
              id="tpl-body"
              value={editor.body}
              rows={6}
              placeholder="The starting message — structure it with the prompts agents should fill in…"
              className="mt-1.5 w-full resize-y rounded-sm border border-line bg-surface px-3 py-2 text-[14px] placeholder:text-text-3"
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
            />

            <label className="mt-4 block text-[13px] font-medium" htmlFor="tpl-tags">
              Tags <span className="font-normal text-text-3">(comma-separated)</span>
            </label>
            <input
              id="tpl-tags"
              type="text"
              value={editor.tags}
              placeholder="bug, escalation"
              className={FIELD}
              onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
            />

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={editor.name.trim() === ''}>
                Save template
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
