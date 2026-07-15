import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { AutomationAction, AutomationActionType, TimeRule, TimeTrigger } from '../../data/types';
import { IconPlus, IconTrash } from '../../icons';
import { Select } from './AutomationSettings';

const FIELD = 'h-9 rounded-md border border-line bg-bg px-2.5 text-[13px] outline-none focus:border-line-2';

const TRIGGERS: { value: TimeTrigger; label: string }[] = [
  { value: 'awaiting_first_response', label: 'No first response' },
  { value: 'awaiting_reply', label: 'Customer waiting on us' },
  { value: 'awaiting_customer', label: 'Waiting on the customer' },
];
const ACTION_TYPES: { value: AutomationActionType; label: string }[] = [
  { value: 'set_priority', label: 'Set priority' },
  { value: 'set_status', label: 'Set status' },
  { value: 'set_category', label: 'Set category' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'assign', label: 'Assign to' },
];
const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
];
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' }, { value: 'pending', label: 'Pending' }, { value: 'on_hold', label: 'On hold' },
  { value: 'solved', label: 'Solved' }, { value: 'closed', label: 'Closed' },
];

let seq = 0;
function makeRule(): TimeRule {
  return { id: `time_${Date.now().toString(36)}_${seq++}`, name: 'New rule', enabled: false, trigger: 'awaiting_first_response', hours: 4, actions: [{ type: 'add_tag', value: '' }] };
}

/** Time-based rules editor (escalations + stale-ticket cleanup). */
export function TimeRulesSection() {
  const stored = useApp((s) => s.timeRules);
  const saveTimeRules = useApp((s) => s.saveTimeRules);
  const runTimeRules = useApp((s) => s.runTimeRules);
  const agents = useApp((s) => s.agents);
  const agentOptions = Object.values(agents).filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: a.name }));

  const [rules, setRules] = useState<TimeRule[]>(stored);
  const [running, setRunning] = useState(false);
  useEffect(() => setRules(stored), [stored]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(stored);

  const patchRule = (id: string, fn: (r: TimeRule) => TimeRule) => setRules((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  function save() {
    void saveTimeRules(rules).then(() => toast('Rules saved')).catch(() => toast('Could not save the rules'));
  }
  async function run() {
    setRunning(true);
    try {
      const n = await runTimeRules();
      toast(n === 0 ? 'No tickets matched right now' : `Acted on ${n} ticket${n === 1 ? '' : 's'}`);
    } catch {
      toast('Could not run the rules');
    } finally {
      setRunning(false);
    }
  }

  function actionValue(rule: TimeRule, action: AutomationAction, i: number) {
    const set = (a: AutomationAction) => patchRule(rule.id, (r) => ({ ...r, actions: r.actions.map((x, j) => (j === i ? a : x)) }));
    if (action.type === 'set_priority') return <Select ariaLabel="Priority" value={action.value} options={PRIORITY_OPTIONS} onChange={(v) => set({ type: 'set_priority', value: v })} className="flex-1" />;
    if (action.type === 'set_status') return <Select ariaLabel="Status" value={action.value} options={STATUS_OPTIONS} onChange={(v) => set({ type: 'set_status', value: v })} className="flex-1" />;
    if (action.type === 'assign') return <Select ariaLabel="Assignee" value={action.value} options={agentOptions} placeholder="Choose agent" onChange={(v) => set({ type: 'assign', value: v })} className="flex-1" />;
    const ph = action.type === 'set_category' ? 'Category' : 'Tag';
    return <input className={cx(FIELD, 'flex-1')} placeholder={ph} aria-label={ph} value={action.value} onChange={(e) => set({ type: action.type, value: e.target.value })} />;
  }

  return (
    <div className="mb-6 border-b border-line pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">
            <Tooltip title="Time-based rules" label="Rules that fire once when a ticket has sat in a state for a set number of hours — great for SLA escalations and tidying up stale tickets. They also run automatically in the background.">
              <span>Time-based rules</span>
            </Tooltip>
          </h2>
          <p className="mt-1 text-[13px] text-text-3">
            Escalate or tidy up tickets automatically after they sit untouched — bump priority if there’s no first
            response in a few hours, or auto-solve tickets waiting on the customer.
          </p>
        </div>
        <Button variant="subtle" size="sm" disabled={running} onClick={() => void run()}>
          {running ? 'Running…' : 'Run now'}
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <input
                className={cx(FIELD, 'min-w-0 flex-1 font-medium')}
                aria-label="Rule name"
                value={rule.name}
                onChange={(e) => patchRule(rule.id, (r) => ({ ...r, name: e.target.value }))}
              />
              <Switch enabled={rule.enabled} onToggle={() => patchRule(rule.id, (r) => ({ ...r, enabled: !r.enabled }))} label="Enable rule" />
              <button
                type="button"
                aria-label="Delete rule"
                className="rounded-sm p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-red"
                onClick={() => setRules((rs) => rs.filter((r) => r.id !== rule.id))}
              >
                <IconTrash size={15} />
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-text-3">When</span>
              <Select
                ariaLabel="Trigger"
                value={rule.trigger}
                options={TRIGGERS}
                onChange={(v) => patchRule(rule.id, (r) => ({ ...r, trigger: v as TimeTrigger }))}
                className="w-52"
              />
              <span className="text-text-3">for</span>
              <input
                type="number"
                min={1}
                aria-label="Hours"
                className={cx(FIELD, 'w-20 text-right tabular-nums')}
                value={rule.hours}
                onChange={(e) => patchRule(rule.id, (r) => ({ ...r, hours: Math.max(1, Math.round(Number(e.target.value) || 1)) }))}
              />
              <span className="text-text-3">hours, then:</span>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              {rule.actions.map((action, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    ariaLabel="Action type"
                    value={action.type}
                    options={ACTION_TYPES}
                    onChange={(type) => patchRule(rule.id, (r) => ({ ...r, actions: r.actions.map((x, j) => (j === i ? { type: type as AutomationActionType, value: '' } : x)) }))}
                    className="w-44"
                  />
                  {actionValue(rule, action, i)}
                  <button
                    type="button"
                    aria-label="Remove action"
                    disabled={rule.actions.length <= 1}
                    className="rounded-sm p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
                    onClick={() => patchRule(rule.id, (r) => ({ ...r, actions: r.actions.filter((_, j) => j !== i) }))}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="inline-flex items-center gap-1 self-start rounded-sm px-1.5 py-1 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                onClick={() => patchRule(rule.id, (r) => ({ ...r, actions: [...r.actions, { type: 'add_tag', value: '' }] }))}
              >
                <IconPlus size={13} />
                Add action
              </button>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2">
          <Button variant="subtle" size="sm" onClick={() => setRules((rs) => [...rs, makeRule()])}>
            <IconPlus size={14} />
            Add rule
          </Button>
          {dirty && (
            <Button size="sm" onClick={save}>
              Save changes
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
