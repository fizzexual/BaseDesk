import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConditionType,
  AutomationRule,
  TicketPriority,
  TicketStatus,
} from '../../data/types';
import { IconChevronDown, IconFilter, IconPlus, IconTrash, IconX } from '../../icons';
import { AutoAssignSection, AutoAckSection } from './AutoAssignSettings';
import { TimeRulesSection } from './TimeRulesSettings';

const CONDITION_TYPES: { value: AutomationConditionType; label: string }[] = [
  { value: 'subject_contains', label: 'Subject contains' },
  { value: 'body_contains', label: 'Message contains' },
  { value: 'from_contains', label: 'Sender contains' },
  { value: 'priority_is', label: 'Priority is' },
  { value: 'channel_is', label: 'Channel is' },
];

const ACTION_TYPES: { value: AutomationActionType; label: string }[] = [
  { value: 'set_priority', label: 'Set priority' },
  { value: 'set_status', label: 'Set status' },
  { value: 'set_category', label: 'Set category' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'assign', label: 'Assign to' },
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'solved', label: 'Solved' },
  { value: 'closed', label: 'Closed' },
];

const CHANNEL_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'webchat', label: 'Web chat' },
  { value: 'email', label: 'Email' },
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webhook', label: 'Webhook' },
];

const MATCH_OPTIONS: { value: 'all' | 'any'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'any', label: 'Any' },
];

const RUN_ON_OPTIONS: { value: 'create' | 'create_update'; label: string }[] = [
  { value: 'create', label: 'When created' },
  { value: 'create_update', label: 'Created or updated' },
];

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

const PRIORITY_VALUES = PRIORITY_OPTIONS.map((o) => o.value) as string[];
function isPriority(v: string): v is TicketPriority {
  return PRIORITY_VALUES.includes(v);
}

const FIELD =
  'h-9 min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select',
  className,
}: {
  value: string;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      align="start"
      triggerLabel={ariaLabel}
      triggerClassName={cx(
        'h-9 justify-between gap-2 rounded-md border border-line bg-bg px-2.5 text-[14px] hover:border-line-2',
        className,
      )}
      trigger={
        <>
          <span className={cx('min-w-0 truncate', current ? 'text-text' : 'text-text-3')}>
            {current?.label ?? placeholder}
          </span>
          <IconChevronDown size={14} className="shrink-0 text-text-3" />
        </>
      }
      items={options.map((o) => ({
        label: o.label,
        checked: o.value === value,
        onSelect: () => onChange(o.value),
      }))}
    />
  );
}

function defaultConditionValue(type: AutomationConditionType, prev: string): string {
  if (type === 'priority_is') return isPriority(prev) ? prev : 'urgent';
  if (type === 'channel_is') return CHANNEL_TYPE_OPTIONS.some((o) => o.value === prev) ? prev : 'webchat';
  // Text conditions: keep prior free text, but not a leftover priority/channel token.
  return isPriority(prev) || CHANNEL_TYPE_OPTIONS.some((o) => o.value === prev) ? '' : prev;
}

function defaultActionValue(type: AutomationActionType, prev: string, agentIds: string[]): string {
  if (type === 'set_priority') return isPriority(prev) ? prev : 'urgent';
  if (type === 'set_status') return STATUS_OPTIONS.some((o) => o.value === prev) ? prev : 'open';
  if (type === 'assign') return agentIds.includes(prev) ? prev : (agentIds[0] ?? '');
  // set_category / add_tag: free text — drop any leftover priority/agent token.
  return isPriority(prev) || agentIds.includes(prev) ? '' : prev;
}

function cloneRules(rules: AutomationRule[]): AutomationRule[] {
  return rules.map((r) => ({
    ...r,
    conditions: r.conditions.map((c) => ({ ...c })),
    actions: r.actions.map((a) => ({ ...a })),
  }));
}

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 8);
}

export function AutomationSettings() {
  const automation = useApp((s) => s.automation);
  const agents = useApp((s) => s.agents);
  const saveAutomation = useApp((s) => s.saveAutomation);
  const [rules, setRules] = useState<AutomationRule[]>(() => cloneRules(automation));
  const [saving, setSaving] = useState(false);

  const agentOptions = useMemo(
    () => Object.values(agents).map((a) => ({ value: a.id, label: a.name })),
    [agents],
  );
  const agentIds = useMemo(() => agentOptions.map((o) => o.value), [agentOptions]);

  function updateRule(id: string, patch: Partial<AutomationRule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function setConditions(rule: AutomationRule, conditions: AutomationCondition[]) {
    updateRule(rule.id, { conditions });
  }
  function setActions(rule: AutomationRule, actions: AutomationAction[]) {
    updateRule(rule.id, { actions });
  }

  function addRule() {
    setRules((rs) => [
      ...rs,
      {
        id: randomId('rule_'),
        name: 'New rule',
        enabled: true,
        match: 'all',
        conditions: [{ type: 'subject_contains', value: '' }],
        actions: [{ type: 'add_tag', value: '' }],
        runOn: 'create',
      },
    ]);
  }

  function removeRule(id: string) {
    setRules((rs) => rs.filter((r) => r.id !== id));
  }

  async function onSave() {
    setSaving(true);
    try {
      await saveAutomation(rules);
      toast('Automation saved');
    } catch {
      toast('Could not save automation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <AutoAssignSection />
      <AutoAckSection />
      <TimeRulesSection />
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Automation</h2>
        <Button variant="subtle" size="sm" onClick={addRule}>
          <IconPlus size={15} />
          Add rule
        </Button>
      </div>
      <p className="mt-2 text-[13px] text-text-3">
        Rules run in order, applying every action when their conditions match. Combine conditions
        with All (met together) or Any (any one), and choose whether a rule fires on create or on
        every update.
      </p>

      {rules.length === 0 ? (
        <EmptyState
          icon={IconFilter}
          title="No automation rules yet"
          hint="Add a rule to triage new tickets automatically as they arrive."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Rule name"
                  placeholder="Rule name"
                  value={rule.name}
                  onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                  className={cx(FIELD, 'font-medium')}
                />
                <SegmentedControl
                  options={ON_OFF}
                  value={rule.enabled ? 'on' : 'off'}
                  onChange={(v) => updateRule(rule.id, { enabled: v === 'on' })}
                />
                <Tooltip label={`Delete ${rule.name}`}>
                  <button
                    type="button"
                    aria-label={`Delete ${rule.name}`}
                    onClick={() => removeRule(rule.id)}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-red-bg hover:text-red"
                  >
                    <IconTrash size={16} />
                  </button>
                </Tooltip>
              </div>

              {/* Conditions */}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[12px] font-medium text-text-3">Match</span>
                <SegmentedControl
                  options={MATCH_OPTIONS}
                  value={rule.match}
                  onChange={(v) => updateRule(rule.id, { match: v })}
                />
                <span className="text-[12px] text-text-3">of these conditions</span>
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {rule.conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      ariaLabel="Condition type"
                      value={cond.type}
                      options={CONDITION_TYPES}
                      onChange={(type) => {
                        const next = [...rule.conditions];
                        next[i] = { type, value: defaultConditionValue(type, cond.value) };
                        setConditions(rule, next);
                      }}
                      className="w-44"
                    />
                    {cond.type === 'priority_is' ? (
                      <Select
                        ariaLabel="Condition priority"
                        value={cond.value}
                        options={PRIORITY_OPTIONS}
                        placeholder="Priority"
                        onChange={(value) => {
                          const next = [...rule.conditions];
                          next[i] = { type: 'priority_is', value };
                          setConditions(rule, next);
                        }}
                        className="flex-1"
                      />
                    ) : cond.type === 'channel_is' ? (
                      <Select
                        ariaLabel="Condition channel"
                        value={cond.value}
                        options={CHANNEL_TYPE_OPTIONS}
                        placeholder="Channel"
                        onChange={(value) => {
                          const next = [...rule.conditions];
                          next[i] = { type: 'channel_is', value };
                          setConditions(rule, next);
                        }}
                        className="flex-1"
                      />
                    ) : (
                      <input
                        type="text"
                        aria-label="Condition value"
                        placeholder={cond.type === 'from_contains' ? 'Email or handle' : 'Text to match'}
                        value={cond.value}
                        onChange={(e) => {
                          const next = [...rule.conditions];
                          next[i] = { type: cond.type, value: e.target.value };
                          setConditions(rule, next);
                        }}
                        className={FIELD}
                      />
                    )}
                    <Tooltip label="Remove condition">
                      <button
                        type="button"
                        aria-label="Remove condition"
                        disabled={rule.conditions.length === 1}
                        onClick={() => setConditions(rule, rule.conditions.filter((_, j) => j !== i))}
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-3 transition-colors enabled:hover:bg-surface-2 enabled:hover:text-text disabled:opacity-30"
                      >
                        <IconX size={15} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setConditions(rule, [...rule.conditions, { type: 'subject_contains', value: '' }])
                  }
                  className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-accent hover:underline"
                >
                  <IconPlus size={14} />
                  Add condition
                </button>
              </div>

              <div className="my-3 border-t border-line" />

              {/* Actions */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-text-3">Then</span>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {rule.actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      ariaLabel="Action type"
                      value={action.type}
                      options={ACTION_TYPES}
                      onChange={(type) => {
                        const next = [...rule.actions];
                        next[i] = { type, value: defaultActionValue(type, action.value, agentIds) };
                        setActions(rule, next);
                      }}
                      className="w-44"
                    />
                    {action.type === 'set_priority' ? (
                      <Select
                        ariaLabel="Action priority"
                        value={action.value}
                        options={PRIORITY_OPTIONS}
                        placeholder="Priority"
                        onChange={(value) => {
                          const next = [...rule.actions];
                          next[i] = { type: 'set_priority', value };
                          setActions(rule, next);
                        }}
                        className="flex-1"
                      />
                    ) : action.type === 'set_status' ? (
                      <Select
                        ariaLabel="Action status"
                        value={action.value}
                        options={STATUS_OPTIONS}
                        placeholder="Status"
                        onChange={(value) => {
                          const next = [...rule.actions];
                          next[i] = { type: 'set_status', value };
                          setActions(rule, next);
                        }}
                        className="flex-1"
                      />
                    ) : action.type === 'assign' ? (
                      <Select
                        ariaLabel="Assignee"
                        value={action.value}
                        options={agentOptions}
                        placeholder="Choose agent"
                        onChange={(value) => {
                          const next = [...rule.actions];
                          next[i] = { type: 'assign', value };
                          setActions(rule, next);
                        }}
                        className="flex-1"
                      />
                    ) : action.type === 'set_category' ? (
                      <input
                        type="text"
                        aria-label="Category"
                        placeholder="Category (e.g. Billing)"
                        value={action.value}
                        onChange={(e) => {
                          const next = [...rule.actions];
                          next[i] = { type: 'set_category', value: e.target.value };
                          setActions(rule, next);
                        }}
                        className={FIELD}
                      />
                    ) : (
                      <input
                        type="text"
                        aria-label="Tag to add"
                        placeholder="Tag to add"
                        value={action.value}
                        onChange={(e) => {
                          const next = [...rule.actions];
                          next[i] = { type: 'add_tag', value: e.target.value };
                          setActions(rule, next);
                        }}
                        className={FIELD}
                      />
                    )}
                    <Tooltip label="Remove action">
                      <button
                        type="button"
                        aria-label="Remove action"
                        disabled={rule.actions.length === 1}
                        onClick={() => setActions(rule, rule.actions.filter((_, j) => j !== i))}
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-3 transition-colors enabled:hover:bg-surface-2 enabled:hover:text-text disabled:opacity-30"
                      >
                        <IconX size={15} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setActions(rule, [...rule.actions, { type: 'add_tag', value: '' }])}
                  className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-accent hover:underline"
                >
                  <IconPlus size={14} />
                  Add action
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <span className="text-[12px] font-medium text-text-3">Run</span>
                <Select
                  ariaLabel="Run on"
                  value={rule.runOn}
                  options={RUN_ON_OPTIONS}
                  onChange={(runOn) => updateRule(rule.id, { runOn })}
                  className="w-52"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save rules'}
        </Button>
      </div>
    </section>
  );
}
