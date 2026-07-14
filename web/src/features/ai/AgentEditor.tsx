import { useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import type { AiAgent, Autonomy, TicketPriority } from '../../data/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconX } from '../../icons';

const FIELD = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2';
const LABEL = 'mb-1.5 block text-[13px] font-medium text-text-2';

const AUTONOMY_OPTIONS: { value: Autonomy; label: string }[] = [
  { value: 'suggest', label: 'Suggest' },
  { value: 'draft', label: 'Draft' },
  { value: 'resolve', label: 'Resolve' },
];
const AUTONOMY_DESC: Record<Autonomy, string> = {
  suggest: 'Triage only — proposes priority and topic tags for you to apply.',
  draft: 'Prepares replies and queues them for your approval.',
  resolve: 'Auto-answers confident KB matches and drafts the rest.',
};

const ENABLED_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function AgentEditor({
  open,
  onClose,
  agent,
}: {
  open: boolean;
  onClose: () => void;
  agent?: AiAgent;
}) {
  const tickets = useApp((s) => s.tickets);
  const categories = useApp((s) => s.categories);
  const createAiAgent = useApp((s) => s.createAiAgent);
  const updateAiAgent = useApp((s) => s.updateAiAgent);
  const deleteAiAgent = useApp((s) => s.deleteAiAgent);

  const editing = agent !== undefined;

  const [name, setName] = useState(agent?.name ?? '');
  const [autonomy, setAutonomy] = useState<Autonomy>(agent?.autonomy ?? 'draft');
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [scopeTags, setScopeTags] = useState<string[]>(agent?.scopeTags ?? []);
  const [scopePriorities, setScopePriorities] = useState<TicketPriority[]>(agent?.scopePriorities ?? []);
  const [scopeCategories, setScopeCategories] = useState<string[]>(agent?.scopeCategories ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tagOptions = useMemo(() => {
    const all = new Set<string>();
    for (const t of Object.values(tickets)) for (const tag of t.tags) all.add(tag);
    for (const tag of scopeTags) all.delete(tag);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [tickets, scopeTags]);

  const valid = name.trim() !== '';
  const allTickets = scopeTags.length === 0 && scopePriorities.length === 0 && scopeCategories.length === 0;

  function addTag() {
    const tag = tagDraft.trim();
    if (tag !== '' && !scopeTags.includes(tag)) setScopeTags([...scopeTags, tag]);
    setTagDraft('');
  }

  function togglePriority(p: TicketPriority) {
    setScopePriorities(
      scopePriorities.includes(p) ? scopePriorities.filter((x) => x !== p) : [...scopePriorities, p],
    );
  }

  function toggleCategory(c: string) {
    setScopeCategories(
      scopeCategories.includes(c) ? scopeCategories.filter((x) => x !== c) : [...scopeCategories, c],
    );
  }

  async function save() {
    if (!valid) return;
    try {
      if (editing) {
        await updateAiAgent(agent.id, { name: name.trim(), autonomy, enabled, scopeTags, scopePriorities, scopeCategories });
        toast('Agent saved');
      } else {
        await createAiAgent({ name: name.trim(), autonomy, scopeTags, scopePriorities, scopeCategories });
        toast('Agent created');
      }
      onClose();
    } catch {
      toast('Could not save the agent');
    }
  }

  async function remove() {
    if (!editing) return;
    try {
      await deleteAiAgent(agent.id);
      toast('Agent deleted');
      onClose();
    } catch {
      toast('Could not delete the agent');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit agent' : 'New agent'} width={480}>
      <div className="flex flex-col gap-3.5">
        <div>
          <label className={LABEL} htmlFor="agent-name">Name</label>
          <input
            id="agent-name"
            className={FIELD}
            placeholder="Billing assistant"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <span className={LABEL}>
            <Tooltip
              title="Autonomy"
              label="How much this agent can do without you: Suggest only proposes tags, Draft queues replies for your approval, Resolve auto-answers confident matches and drafts the rest."
            >
              <span>Autonomy</span>
            </Tooltip>
          </span>
          <SegmentedControl options={AUTONOMY_OPTIONS} value={autonomy} onChange={setAutonomy} />
          <p className="mt-1.5 text-[13px] text-text-3">{AUTONOMY_DESC[autonomy]}</p>
        </div>

        {editing && (
          <div>
            <span className={LABEL}>Enabled</span>
            <SegmentedControl
              options={ENABLED_OPTIONS}
              value={enabled ? 'on' : 'off'}
              onChange={(v) => setEnabled(v === 'on')}
            />
          </div>
        )}

        <div>
          <span className={LABEL}>Scope — tags</span>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-bg p-2 focus-within:border-line-2">
            {scopeTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-text-2"
              >
                {tag}
                <Tooltip label={`Remove ${tag}`}>
                  <button
                    type="button"
                    aria-label={`Remove ${tag}`}
                    className="text-text-3 hover:text-text"
                    onClick={() => setScopeTags(scopeTags.filter((t) => t !== tag))}
                  >
                    <IconX size={10} />
                  </button>
                </Tooltip>
              </span>
            ))}
            <input
              list="agent-tag-options"
              value={tagDraft}
              aria-label="Add scope tag"
              placeholder={scopeTags.length === 0 ? 'Any tag' : 'Add tag'}
              className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-text-3"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                } else if (e.key === 'Backspace' && tagDraft === '' && scopeTags.length > 0) {
                  setScopeTags(scopeTags.slice(0, -1));
                }
              }}
              onBlur={addTag}
            />
            <datalist id="agent-tag-options">
              {tagOptions.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <span className={LABEL}>Scope — priorities</span>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITIES.map((p) => {
              const active = scopePriorities.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  className={cx(
                    'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors',
                    active
                      ? 'border-accent bg-accent text-accent-fg'
                      : 'border-line text-text-2 hover:bg-surface-2 hover:text-text',
                  )}
                  onClick={() => togglePriority(p)}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className={LABEL}>Scope — categories</span>
          {categories.length === 0 ? (
            <p className="text-[13px] text-text-3">Define categories in Settings → Ticket form.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const active = scopeCategories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    className={cx(
                      'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors',
                      active
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-line text-text-2 hover:bg-surface-2 hover:text-text',
                    )}
                    onClick={() => toggleCategory(c)}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {allTickets && (
          <p className="text-[13px] text-text-3">
            With no tags, priorities, or categories selected, this agent considers all open tickets.
          </p>
        )}

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
