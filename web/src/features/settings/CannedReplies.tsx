import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';
import { IconDots, IconNote, IconPlus, IconTrash } from '../../icons';

interface EditorState {
  id: string | null;
  title: string;
  body: string;
}

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
      await saveCanned({ id: editor.id ?? '', title, body });
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
        <h2 className="text-[15px] font-semibold">Canned replies</h2>
        <Button
          variant="subtle"
          size="sm"
          onClick={() => setEditor({ id: null, title: '', body: '' })}
        >
          <IconPlus size={15} />
          New canned reply
        </Button>
      </div>

      {canned.length === 0 ? (
        <EmptyState
          icon={IconNote}
          title="No canned replies yet"
          hint="Save the answers you type most often and reuse them from the composer."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {canned.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-md border border-line p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{c.title}</div>
                <div className="truncate text-[13px] text-text-3">{c.body}</div>
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
                    onSelect: () => setEditor({ id: c.id, title: c.title, body: c.body }),
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
              rows={6}
              placeholder="Write the reply agents will insert…"
              className="mt-1.5 w-full resize-y rounded-sm border border-line bg-surface px-3 py-2 text-[14px] placeholder:text-text-3"
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={editor.title.trim() === '' || editor.body.trim() === ''}
              >
                Save reply
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
