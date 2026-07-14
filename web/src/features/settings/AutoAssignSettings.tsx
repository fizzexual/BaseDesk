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
              label="Round-robin cycles through active agents in turn. Least busy always goes to whoever currently has the fewest open tickets."
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
              : 'Assigns to the active agent with the fewest open tickets.'}
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
