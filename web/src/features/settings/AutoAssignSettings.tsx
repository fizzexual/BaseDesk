import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { useApp } from '../../data/store';
import type { AssignmentSettings } from '../../data/types';

/** Auto-assignment controls, shown at the top of the Automation settings tab. */
export function AutoAssignSection() {
  const assignment = useApp((s) => s.assignment);
  const saveAssignment = useApp((s) => s.saveAssignment);
  const agents = useApp((s) => s.agents);
  const activeCount = Object.values(agents).filter((a) => a.status === 'active').length;

  function save(next: AssignmentSettings) {
    void saveAssignment(next).catch(() => toast('Could not save assignment settings'));
  }

  return (
    <div className="mb-6 border-b border-line pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Auto-assignment</h2>
          <p className="mt-1 text-[13px] text-text-3">
            Route new unassigned tickets to your active agents automatically as they arrive.
          </p>
        </div>
        <Switch
          enabled={assignment.enabled}
          onToggle={() => save({ ...assignment, enabled: !assignment.enabled })}
          label="Enable auto-assignment"
        />
      </div>

      {assignment.enabled && (
        <div className="mt-4">
          <div className="text-[13px] font-medium">
            <Tooltip
              title="Assignment strategy"
              label="Round-robin cycles through active agents in turn. Least busy always goes to whoever currently has the fewest open tickets. Either way, tickets with a category route to agents who cover it."
            >
              Strategy
            </Tooltip>
          </div>
          <div className="mt-2">
            <SegmentedControl<AssignmentSettings['strategy']>
              options={[
                { value: 'round_robin', label: 'Round-robin' },
                { value: 'least_busy', label: 'Least busy' },
              ]}
              value={assignment.strategy}
              onChange={(strategy) => save({ ...assignment, strategy })}
            />
          </div>
          <p className="mt-2 text-[12px] text-text-3">
            {assignment.strategy === 'round_robin'
              ? 'Cycles through active agents in turn.'
              : 'Assigns to the active agent with the fewest open tickets.'}{' '}
            Tickets with a category prefer agents who cover it.
          </p>
          <p className="mt-1.5 text-[12px] text-text-3">
            {activeCount === 0
              ? 'No active agents right now — tickets stay unassigned until an agent is active.'
              : `${activeCount} active agent${activeCount === 1 ? '' : 's'} in the pool.`}
          </p>
        </div>
      )}
    </div>
  );
}

/** Auto-acknowledgement: an instant first reply the moment a ticket is opened. */
export function AutoAckSection() {
  const autoAck = useApp((s) => s.autoAck);
  const saveAutoAck = useApp((s) => s.saveAutoAck);
  const [message, setMessage] = useState(autoAck.message);
  useEffect(() => setMessage(autoAck.message), [autoAck.message]);
  const dirty = message !== autoAck.message;

  return (
    <div className="mb-6 border-b border-line pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Auto-acknowledgement</h2>
          <p className="mt-1 text-[13px] text-text-3">
            Send an instant first reply when a ticket is opened, so customers know it arrived. It doesn’t count as your
            team’s SLA first response.
          </p>
        </div>
        <Switch
          enabled={autoAck.enabled}
          onToggle={() => void saveAutoAck({ ...autoAck, enabled: !autoAck.enabled }).catch(() => toast('Could not save auto-acknowledgement'))}
          label="Enable auto-acknowledgement"
        />
      </div>

      {autoAck.enabled && (
        <div className="mt-4">
          <label htmlFor="autoack-msg" className="text-[13px] font-medium">
            Auto-reply message
          </label>
          <textarea
            id="autoack-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="mt-2 w-full resize-y rounded-md border border-line bg-bg p-2.5 text-[13px] leading-relaxed outline-none focus:border-line-2"
          />
          <p className="mt-1.5 text-[12px] text-text-3">
            Placeholders: <code className="rounded bg-surface-2 px-1 py-0.5">{'{{number}}'}</code> ticket number ·{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5">{'{{name}}'}</code> customer first name.
          </p>
          <div className="mt-2.5">
            <Button
              size="sm"
              disabled={!dirty || message.trim() === ''}
              onClick={() =>
                void saveAutoAck({ ...autoAck, message })
                  .then(() => toast('Auto-reply saved'))
                  .catch(() => toast('Could not save auto-acknowledgement'))
              }
            >
              Save message
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
