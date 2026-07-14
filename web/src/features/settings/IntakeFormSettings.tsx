import { useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import type { IntakeForm, IntakeNode, IntakeOption } from '../../data/types';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { Tooltip } from '../../components/Tooltip';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconPlus, IconTrash, IconX } from '../../icons';

const uid = (p: string): string => `${p}${crypto.randomUUID().slice(0, 8)}`;
const clone = (f: IntakeForm): IntakeForm => structuredClone(f);

const INPUT =
  'h-8 w-full rounded-sm border border-line bg-surface px-2 text-[13px] outline-none placeholder:text-text-3 focus:border-line-2';

/**
 * Admin builder for the branching intake form: a decision tree of dropdown
 * questions. Each option ends the flow or leads to a follow-up question, and can
 * set the ticket's category and add tags. The first question is the "Start" node.
 */
export function IntakeFormSettings() {
  const saved = useApp((s) => s.intakeForm);
  const saveIntakeForm = useApp((s) => s.saveIntakeForm);
  const [form, setForm] = useState<IntakeForm>(() => clone(saved));
  const [busy, setBusy] = useState(false);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const nodes = Object.values(form.nodes);

  function mutate(fn: (draft: IntakeForm) => void) {
    setForm((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
  }

  function addQuestion() {
    mutate((d) => {
      const id = uid('n_');
      d.nodes[id] = { id, prompt: '', options: [{ id: uid('o_'), label: '', next: null, category: null, tags: [] }] };
      if (d.rootId === null) d.rootId = id;
    });
  }

  function removeQuestion(nodeId: string) {
    mutate((d) => {
      delete d.nodes[nodeId];
      // Detach any option that pointed here so the tree stays valid.
      for (const n of Object.values(d.nodes)) for (const o of n.options) if (o.next === nodeId) o.next = null;
      if (d.rootId === nodeId) d.rootId = Object.keys(d.nodes)[0] ?? null;
    });
  }

  function patchNode(nodeId: string, patch: Partial<IntakeNode>) {
    mutate((d) => { if (d.nodes[nodeId]) Object.assign(d.nodes[nodeId], patch); });
  }

  function patchOption(nodeId: string, optId: string, patch: Partial<IntakeOption>) {
    mutate((d) => {
      const opt = d.nodes[nodeId]?.options.find((o) => o.id === optId);
      if (opt) Object.assign(opt, patch);
    });
  }

  function addOption(nodeId: string) {
    mutate((d) => { d.nodes[nodeId]?.options.push({ id: uid('o_'), label: '', next: null, category: null, tags: [] }); });
  }

  function removeOption(nodeId: string, optId: string) {
    mutate((d) => {
      const n = d.nodes[nodeId];
      if (n) n.options = n.options.filter((o) => o.id !== optId);
    });
  }

  /** Handle the "then…" dropdown: end, jump to an existing question, or spawn a follow-up. */
  function setNext(nodeId: string, optId: string, value: string) {
    if (value === '__new') {
      mutate((d) => {
        const id = uid('n_');
        d.nodes[id] = { id, prompt: '', options: [{ id: uid('o_'), label: '', next: null, category: null, tags: [] }] };
        const opt = d.nodes[nodeId]?.options.find((o) => o.id === optId);
        if (opt) opt.next = id;
      });
    } else {
      patchOption(nodeId, optId, { next: value === '' ? null : value });
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) for (const o of n.options) if (o.category) set.add(o.category);
    return [...set].sort();
  }, [nodes]);

  async function save() {
    setBusy(true);
    try {
      await saveIntakeForm(form);
      toast('Ticket form saved');
    } catch {
      toast('Could not save the ticket form');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Ticket form</h2>
          <p className="mt-1 text-[13px] text-text-3">
            Ask customers a few branching questions when they open a ticket. Their answers set the
            ticket&apos;s category (used to route it to the right team) and add tags.
          </p>
        </div>
        <Switch
          enabled={form.enabled}
          onToggle={() => mutate((d) => { d.enabled = !d.enabled; })}
          label="Enable the intake form"
        />
      </div>

      {form.enabled && (
        <div className="mt-5 flex flex-col gap-3">
          {nodes.length === 0 && (
            <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[13px] text-text-3">
              No questions yet. Add your first question to start the form.
            </p>
          )}

          {nodes.map((node) => {
            const isRoot = node.id === form.rootId;
            return (
              <div key={node.id} className="rounded-md border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-center gap-2">
                  {isRoot ? (
                    <Tooltip title="Start" label="The first question every customer sees.">
                      <span className="rounded-full bg-blue-bg px-2 py-0.5 text-[11px] font-semibold text-blue">Start</span>
                    </Tooltip>
                  ) : (
                    <button
                      type="button"
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-text-3 hover:bg-surface-3 hover:text-text"
                      onClick={() => mutate((d) => { d.rootId = node.id; })}
                    >
                      Set as start
                    </button>
                  )}
                  <span className="ml-auto" />
                  <Tooltip label="Delete question">
                    <button
                      type="button"
                      aria-label="Delete question"
                      className="inline-flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-red-bg hover:text-red"
                      onClick={() => removeQuestion(node.id)}
                    >
                      <IconTrash size={15} />
                    </button>
                  </Tooltip>
                </div>

                <input
                  className={cx(INPUT, 'mb-2.5 font-medium')}
                  placeholder="Question, e.g. What do you need help with?"
                  value={node.prompt}
                  onChange={(e) => patchNode(node.id, { prompt: e.target.value })}
                />

                <div className="flex flex-col gap-2">
                  {node.options.map((opt) => (
                    <div key={opt.id} className="rounded-sm border border-line bg-surface p-2">
                      <div className="flex items-center gap-2">
                        <input
                          className={INPUT}
                          placeholder="Answer, e.g. Report a bug"
                          value={opt.label}
                          onChange={(e) => patchOption(node.id, opt.id, { label: e.target.value })}
                        />
                        <Tooltip label="Remove answer">
                          <button
                            type="button"
                            aria-label="Remove answer"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text"
                            onClick={() => removeOption(node.id, opt.id)}
                          >
                            <IconX size={14} />
                          </button>
                        </Tooltip>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] text-text-3">
                            <Tooltip title="Category" label="Sets the ticket's type — used to route it to agents who cover this category. Leave blank to keep the previous answer's category.">
                              Category
                            </Tooltip>
                          </span>
                          <input
                            className={INPUT}
                            list="intake-categories"
                            placeholder="e.g. Bug"
                            value={opt.category ?? ''}
                            onChange={(e) => patchOption(node.id, opt.id, { category: e.target.value.trim() === '' ? null : e.target.value })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] text-text-3">
                            <Tooltip title="Tags" label="Comma-separated tags added to the ticket when this answer is chosen (e.g. skyblock).">
                              Tags
                            </Tooltip>
                          </span>
                          <input
                            className={INPUT}
                            placeholder="skyblock, urgent"
                            value={opt.tags.join(', ')}
                            onChange={(e) =>
                              patchOption(node.id, opt.id, {
                                tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="mt-2 block">
                        <span className="mb-1 block text-[11px] text-text-3">Then…</span>
                        <select
                          className={cx(INPUT, 'cursor-pointer')}
                          value={opt.next ?? ''}
                          onChange={(e) => setNext(node.id, opt.id, e.target.value)}
                        >
                          <option value="">Finish — create the ticket</option>
                          {nodes
                            .filter((n) => n.id !== node.id)
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                Go to: {n.prompt || '(untitled question)'}
                              </option>
                            ))}
                          <option value="__new">+ New follow-up question…</option>
                        </select>
                      </label>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
                  onClick={() => addOption(node.id)}
                >
                  <IconPlus size={13} /> Add answer
                </button>
              </div>
            );
          })}

          <div>
            <Button variant="subtle" size="sm" onClick={addQuestion}>
              <IconPlus size={14} /> Add question
            </Button>
          </div>
        </div>
      )}

      <datalist id="intake-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save form'}
        </Button>
        {dirty && (
          <Button variant="ghost" size="md" onClick={() => setForm(clone(saved))}>
            Discard changes
          </Button>
        )}
        {dirty && <span className="text-[12px] text-text-3">Unsaved changes</span>}
      </div>
    </div>
  );
}
