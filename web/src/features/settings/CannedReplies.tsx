import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { useApp } from '../../data/store';
import type { MacroActions, TicketPriority, TicketStatus } from '../../data/types';
import { IconDots, IconNote, IconPlus, IconSparkle, IconTrash } from '../../icons';

interface EditorState {
  id: string | null;
  title: string;
  body: string;
  status: TicketStatus | '';
  priority: TicketPriority | '';
  assignToMe: boolean;
  tags: string;
}

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'solved', label: 'Solved' },
  { value: 'closed', label: 'Closed' },
];
const PRIORITY_OPTIONS: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];

const SELECT_CLASS =
  'mt-1.5 h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-[14px] capitalize';

function summarizeActions(a: MacroActions): string {
  const parts: string[] = [];
  if (a.status !== undefined) parts.push(a.status.replace('_', ' '));
  if (a.priority !== undefined) parts.push(`${a.priority} priority`);
  if (a.assignToMe === true) parts.push('assign to me');
  if (a.addTags !== undefined && a.addTags.length > 0) parts.push(a.addTags.map((t) => `#${t}`).join(' '));
  return parts.join(' · ');
}

/** Assemble the editor's discrete fields into a MacroActions, or null if none set. */
function buildActions(e: EditorState): MacroActions | null {
  const addTags = [...new Set(e.tags.split(',').map((t) => t.trim()).filter((t) => t !== ''))];
  const actions: MacroActions = {};
  if (e.status !== '') actions.status = e.status;
  if (e.priority !== '') actions.priority = e.priority;
  if (e.assignToMe) actions.assignToMe = true;
  if (addTags.length > 0) actions.addTags = addTags;
  return Object.keys(actions).length > 0 ? actions : null;
}

const BLANK: EditorState = { id: null, title: '', body: '', status: '', priority: '', assignToMe: false, tags: '' };

export function CannedReplies() {
  const canned = useApp((s) => s.canned);
  const saveCanned = useApp((s) => s.saveCanned);
  const deleteCanned = useApp((s) => s.deleteCanned);
  const [editor, setEditor] = useState<EditorState | null>(null);

  async function onSave() {
    if (!editor) return;
    const title = editor.title.trim();
    const body = editor.body.trim();
    if (title === '' || body === '') return;
    try {
      // Empty id = create: both repositories assign the id server-side; a
      // client-generated id would 404 against PUT /api/canned/:id.
      await saveCanned({ id: editor.id ?? '', title, body, actions: buildActions(editor) });
      setEditor(null);
    } catch {
      toast('Could not save the canned reply');
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteCanned(id);
      toast('Canned reply deleted');
    } catch {
      toast('Could not delete the canned reply');
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">
          <Tooltip
            title="Canned replies"
            label="Pre-written templates you can insert — some also change the ticket's status, priority, or assignee."
          >
            Canned replies
          </Tooltip>
        </h2>
        <Button variant="subtle" size="sm" onClick={() => setEditor({ ...BLANK })}>
          <IconPlus size={15} />
          New canned reply
        </Button>
      </div>

      {canned.length === 0 ? (
        <EmptyState
          icon={IconNote}
          title="No canned replies yet"
          hint="Save the answers you type most often and reuse them from the composer. Add actions to turn one into a macro."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {canned.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-md border border-line p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{c.title}</span>
                  {c.actions && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                      <Tooltip
                        title="Macro"
                        label="A canned reply with actions attached — inserting it can also set status, priority, tags, or the assignee."
                      >
                        <span className="inline-flex items-center gap-1">
                          <IconSparkle size={11} />
                          Macro
                        </span>
                      </Tooltip>
                    </span>
                  )}
                </div>
                <div className="truncate text-[13px] text-text-3">{c.body}</div>
                {c.actions && (
                  <div className="mt-0.5 truncate text-[12px] capitalize text-accent">{summarizeActions(c.actions)}</div>
                )}
              </div>
              <Menu
                align="end"
                triggerLabel={`Actions for ${c.title}`}
                triggerClassName="size-7 shrink-0 justify-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                trigger={<IconDots size={16} />}
                items={[
                  {
                    label: 'Edit',
                    icon: <IconNote size={15} />,
                    onSelect: () =>
                      setEditor({
                        id: c.id,
                        title: c.title,
                        body: c.body,
                        status: c.actions?.status ?? '',
                        priority: c.actions?.priority ?? '',
                        assignToMe: c.actions?.assignToMe ?? false,
                        tags: (c.actions?.addTags ?? []).join(', '),
                      }),
                  },
                  {
                    label: 'Delete',
                    icon: <IconTrash size={15} />,
                    danger: true,
                    onSelect: () => void onDelete(c.id),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.id ? 'Edit canned reply' : 'New canned reply'}
      >
        {editor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <label className="block text-[13px] font-medium" htmlFor="canned-title">
              Title
            </label>
            <input
              id="canned-title"
              type="text"
              value={editor.title}
              placeholder="Refund policy"
              className="mt-1.5 h-9 w-full rounded-sm border border-line bg-surface px-3 text-[14px] placeholder:text-text-3"
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
            />
            <label className="mt-4 block text-[13px] font-medium" htmlFor="canned-body">
              Body
            </label>
            <textarea
              id="canned-body"
              value={editor.body}
              rows={5}
              placeholder="Write the reply agents will insert…"
              className="mt-1.5 w-full resize-y rounded-sm border border-line bg-surface px-3 py-2 text-[14px] placeholder:text-text-3"
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
            />

            <div className="mt-5 border-t border-line pt-4">
              <div className="text-[13px] font-medium">When inserted, also…</div>
              <div className="mt-0.5 text-[12px] text-text-3">
                Optional — set any of these to make this a one-click macro.
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-text-2" htmlFor="macro-status">
                    Set status
                  </label>
                  <select
                    id="macro-status"
                    value={editor.status}
                    className={SELECT_CLASS}
                    onChange={(e) => setEditor({ ...editor, status: e.target.value as TicketStatus | '' })}
                  >
                    <option value="">No change</option>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-text-2" htmlFor="macro-priority">
                    Set priority
                  </label>
                  <select
                    id="macro-priority"
                    value={editor.priority}
                    className={SELECT_CLASS}
                    onChange={(e) => setEditor({ ...editor, priority: e.target.value as TicketPriority | '' })}
                  >
                    <option value="">No change</option>
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="mt-3 block text-[12px] text-text-2" htmlFor="macro-tags">
                Add tags <span className="text-text-3">(comma-separated)</span>
              </label>
              <input
                id="macro-tags"
                type="text"
                value={editor.tags}
                placeholder="refund, vip"
                className="mt-1.5 h-9 w-full rounded-sm border border-line bg-surface px-3 text-[14px] placeholder:text-text-3"
                onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
              />
              <label className="mt-3 flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={editor.assignToMe}
                  onChange={(e) => setEditor({ ...editor, assignToMe: e.target.checked })}
                />
                Assign the ticket to me
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={editor.title.trim() === '' || editor.body.trim() === ''}>
                Save reply
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
