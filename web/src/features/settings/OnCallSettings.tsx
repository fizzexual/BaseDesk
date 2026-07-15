import { useEffect, useState } from 'react';
import { useApp } from '../../data/store';
import { currentOnCall, upcomingShifts } from '../../data/oncall';
import { Avatar } from '../../components/Avatar';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { IconArrowDown, IconArrowUp, IconPlus, IconX } from '../../icons';
import type { OnCallCadence, OnCallConfig } from '../../data/types';

const CADENCE_OPTIONS: { value: OnCallCadence; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

function shiftLabel(startsAt: number): string {
  return new Date(startsAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function OnCallSettings() {
  const config = useApp((s) => s.onCall);
  const agents = useApp((s) => s.agents);
  const saveOnCall = useApp((s) => s.saveOnCall);

  // Re-render each minute so "on call now" stays current as shifts roll over.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  function update(patch: Partial<OnCallConfig>) {
    void saveOnCall({ ...config, ...patch }).catch(() => toast('Could not save the on-call schedule'));
  }
  function move(index: number, dir: -1 | 1) {
    const next = [...config.rotation];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update({ rotation: next });
  }

  const inRotation = new Set(config.rotation);
  const available = Object.values(agents)
    .filter((a) => !inRotation.has(a.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const onCallId = currentOnCall(config);
  const onCallAgent = onCallId !== null ? agents[onCallId] : undefined;
  const upcoming = upcomingShifts(config, 4).slice(1); // drop the current shift (shown above)

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">
            <Tooltip title="On-call schedule" label="Rotate on-call duty across the team. Who's on call now is computed from the cadence and rotation order.">
              On-call schedule
            </Tooltip>
          </h2>
          <p className="mt-0.5 text-[13px] text-text-3">Rotate responsibility for urgent tickets across the team.</p>
        </div>
        <Switch enabled={config.enabled} onToggle={() => update({ enabled: !config.enabled })} label="Enable on-call rotation" />
      </div>

      {/* Who's on call now */}
      <div className="rounded-md border border-line p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">On call now</div>
        {!config.enabled ? (
          <p className="mt-2 text-[13px] text-text-3">On-call rotation is off.</p>
        ) : onCallAgent !== undefined ? (
          <div className="mt-2 flex items-center gap-2.5">
            <Avatar name={onCallAgent.name} hue={onCallAgent.avatarHue} size={32} />
            <div>
              <div className="text-[14px] font-medium">{onCallAgent.name}</div>
              <div className="text-[12px] text-text-3">{config.cadence === 'daily' ? "Today's shift" : "This week's shift"}</div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-text-3">Add agents to the rotation to put someone on call.</p>
        )}
      </div>

      {/* Cadence */}
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Rotation cadence</div>
        <SegmentedControl options={CADENCE_OPTIONS} value={config.cadence} onChange={(c) => update({ cadence: c })} />
      </div>

      {/* Rotation order */}
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Rotation order</div>
        {config.rotation.length === 0 ? (
          <p className="text-[13px] text-text-3">No one in the rotation yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {config.rotation.map((id, i) => {
              const a = agents[id];
              if (a === undefined) return null;
              return (
                <li key={id} className="flex items-center gap-2.5 rounded-md border border-line p-2">
                  <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-text-3">{i + 1}</span>
                  <Avatar name={a.name} hue={a.avatarHue} size={26} />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Move ${a.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-30"
                  >
                    <IconArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${a.name} down`}
                    disabled={i === config.rotation.length - 1}
                    onClick={() => move(i, 1)}
                    className="rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-30"
                  >
                    <IconArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name} from the rotation`}
                    onClick={() => update({ rotation: config.rotation.filter((x) => x !== id) })}
                    className="rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    <IconX size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {available.length > 0 && (
          <label className="mt-2.5 flex items-center gap-2 text-[13px]">
            <IconPlus size={15} className="text-text-3" />
            <select
              value=""
              onChange={(e) => {
                if (e.target.value !== '') update({ rotation: [...config.rotation, e.target.value] });
              }}
              aria-label="Add an agent to the rotation"
              className="h-9 flex-1 rounded-sm border border-line bg-surface px-2.5 text-[14px]"
            >
              <option value="">Add an agent to the rotation…</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Upcoming shifts */}
      {config.enabled && upcoming.length > 0 && (
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Coming up</div>
          <ul className="flex flex-col gap-1">
            {upcoming.map((s, i) => {
              const a = agents[s.agentId];
              return (
                <li key={i} className="flex items-center gap-2.5 text-[13px]">
                  <span className="w-24 shrink-0 tabular-nums text-text-3">{shiftLabel(s.startsAt)}</span>
                  {a !== undefined && <Avatar name={a.name} hue={a.avatarHue} size={20} />}
                  <span className="text-text-2">{a?.name ?? 'Unknown'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
