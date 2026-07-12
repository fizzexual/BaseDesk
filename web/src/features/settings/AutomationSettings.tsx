import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Menu } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type {
  AutomationActionType,
  AutomationConditionType,
  AutomationRule,
  TicketPriority,
} from '../../data/types';
import { IconChevronDown, IconFilter, IconPlus, IconTrash } from '../../icons';

const CONDITION_TYPES: { value: AutomationConditionType; label: string }[] = [
  { value: 'subject_contains', label: 'Subject contains' },
  { value: 'body_contains', label: 'Message contains' },
  { value: 'priority_is', label: 'Priority is' },
];

const ACTION_TYPES: { value: AutomationActionType; label: string }[] = [
  { value: 'set_priority', label: 'Set priority' },
  { value: 'add_tag', label: 'Add tag' },
  { value: 'assign', label: 'Assign to' },
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
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

function Select<T extends string>({
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

function cloneRules(rules: AutomationRule[]): AutomationRule[] {
  return rules.map((r) => ({ ...r, condition: { ...r.condition }, action: { ...r.action } }));
}

export function AutomationSettings() {
  const automation = useApp((s) => s.automation);
  const agents = useApp((s) => s.agents);
  const saveAutomation = useApp((s) => s.saveAutomation);
  const [rules, setRules] = useState<AutomationRule[]>(() => cloneRules(automation));

  const agentOptions = useMemo(
    () => Object.values(agents).map((a) => ({ value: a.id, label: a.name })),
    [agents],
  );
  const agentIds = useMemo(() => agentOptions.map((o) => o.value), [agentOptions]);

  function updateRule(id: string, patch: Partial<AutomationRule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function onConditionType(rule: AutomationRule, type: AutomationConditionType) {
    const value =
      type === 'priority_is'
        ? isPriority(rule.condition.value)
          ? rule.condition.value
          : 'urgent'
        : isPriority(rule.condition.value)
          ? ''
          : rule.condition.value;
    updateRule(rule.id, { condition: { type, value } });
  }

  function onActionType(rule: AutomationRule, type: AutomationActionType) {
    const prev = rule.action.value;
    let value: string;
    if (type === 'set_priority') value = isPriority(prev) ? prev : 'urgent';
    else if (type === 'assign') value = agentIds.includes(prev) ? prev : (agentIds[0] ?? '');
    else value = isPriority(prev) || agentIds.includes(prev) ? '' : prev;
    updateRule(rule.id, { action: { type, value } });
  }

  function addRule() {
    setRules((rs) => [
      ...rs,
      {
        id: 'rule_' + Math.random().toString(36).slice(2, 8),
        name: 'New rule',
        enabled: true,
        condition: { type: 'subject_contains', value: '' },
        action: { type: 'add_tag', value: '' },
      },
    ]);
  }

  function removeRule(id: string) {
    setRules((rs) => rs.filter((r) => r.id !== id));
  }

  async function onSave() {
    try {
      await saveAutomation(rules);
      toast('Automation saved');
    } catch {
      toast('Could not save automation');
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Automation</h2>
        <Button variant="subtle" size="sm" onClick={addRule}>
          <IconPlus size={15} />
          Add rule
        </Button>
      </div>
      <p className="mt-2 text-[13px] text-text-3">
        Rules run in order when a ticket is created, applying each action whose condition matches.
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
            <div key={rule.id} className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Rule name"
                  placeholder="Rule name"
                  value={rule.name}
                  onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                  className={FIELD}
                />
                <SegmentedControl
                  options={ON_OFF}
                  value={rule.enabled ? 'on' : 'off'}
                  onChange={(v) => updateRule(rule.id, { enabled: v === 'on' })}
                />
                <button
                  type="button"
                  aria-label={`Delete ${rule.name}`}
                  onClick={() => removeRule(rule.id)}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-red-bg hover:text-red"
                >
                  <IconTrash size={16} />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="w-10 shrink-0 text-[12px] font-medium text-text-3">When</span>
                <Select
                  ariaLabel="Condition type"
                  value={rule.condition.type}
                  options={CONDITION_TYPES}
                  onChange={(type) => onConditionType(rule, type)}
                  className="w-44"
                />
                {rule.condition.type === 'priority_is' ? (
                  <Select
                    ariaLabel="Condition priority"
                    value={rule.condition.value}
                    options={PRIORITY_OPTIONS}
                    placeholder="Priority"
                    onChange={(value) =>
                      updateRule(rule.id, { condition: { type: 'priority_is', value } })
                    }
                    className="w-40"
                  />
                ) : (
                  <input
                    type="text"
                    aria-label="Condition value"
                    placeholder="Text to match"
                    value={rule.condition.value}
                    onChange={(e) =>
                      updateRule(rule.id, {
                        condition: { type: rule.condition.type, value: e.target.value },
                      })
                    }
                    className={FIELD}
                  />
                )}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <span className="w-10 shrink-0 text-[12px] font-medium text-text-3">Then</span>
                <Select
                  ariaLabel="Action type"
                  value={rule.action.type}
                  options={ACTION_TYPES}
                  onChange={(type) => onActionType(rule, type)}
                  className="w-44"
                />
                {rule.action.type === 'set_priority' ? (
                  <Select
                    ariaLabel="Action priority"
                    value={rule.action.value}
                    options={PRIORITY_OPTIONS}
                    placeholder="Priority"
                    onChange={(value) =>
                      updateRule(rule.id, { action: { type: 'set_priority', value } })
                    }
                    className="w-40"
                  />
                ) : rule.action.type === 'assign' ? (
                  <Select
                    ariaLabel="Assignee"
                    value={rule.action.value}
                    options={agentOptions}
                    placeholder="Choose agent"
                    onChange={(value) => updateRule(rule.id, { action: { type: 'assign', value } })}
                    className="w-52"
                  />
                ) : (
                  <input
                    type="text"
                    aria-label="Tag to add"
                    placeholder="Tag to add"
                    value={rule.action.value}
                    onChange={(e) =>
                      updateRule(rule.id, { action: { type: 'add_tag', value: e.target.value } })
                    }
                    className={FIELD}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Button variant="primary" size="sm" onClick={() => void onSave()}>
          Save rules
        </Button>
      </div>
    </section>
  );
}
