import { useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { SlaHours, SlaTargets, TicketPriority } from '../../data/types';

const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];

// Weekday toggles, Monday-first for familiarity; values are JS getDay() indices.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const COMMON_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Africa/Cairo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
];

function allZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (supported) return supported('timeZone');
  } catch {
    // older runtimes — fall back to the curated list
  }
  return COMMON_ZONES;
}

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

type SlaDraft = Record<TicketPriority, { firstResponseMins: string; resolutionMins: string }>;

function toDraft(sla: SlaTargets): SlaDraft {
  const draft = {} as SlaDraft;
  for (const p of PRIORITIES) {
    draft[p] = {
      firstResponseMins: String(sla[p].firstResponseMins),
      resolutionMins: String(sla[p].resolutionMins),
    };
  }
  return draft;
}

/** Parse a minutes field; returns null when empty, non-numeric or negative. */
function parseMins(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Format minutes as a compact "Nm" / "Nh" / "Nd" duration. */
function formatMins(mins: number): string {
  if (mins < 60) return `${round(mins)}m`;
  if (mins < 1440) return `${round(mins / 60)}h`;
  return `${round(mins / 1440)}d`;
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function MinsField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const mins = parseMins(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-24 rounded-md border border-line bg-bg px-2.5 text-[14px] tabular-nums outline-none focus:border-line-2"
      />
      <span className="text-[12px] tabular-nums text-text-3">{mins === null ? '—' : formatMins(mins)}</span>
    </div>
  );
}

export function SlaSettings() {
  const sla = useApp((s) => s.sla);
  const saveSlaTargets = useApp((s) => s.saveSlaTargets);
  const slaHours = useApp((s) => s.slaHours);
  const saveSlaHours = useApp((s) => s.saveSlaHours);
  const [draft, setDraft] = useState<SlaDraft>(() => toDraft(sla));
  const [hours, setHours] = useState<SlaHours>(() => ({ ...slaHours, days: [...slaHours.days] }));
  const [savingHours, setSavingHours] = useState(false);

  const hoursValid = hours.start < hours.end;

  function toggleDay(d: number) {
    setHours((h) => ({
      ...h,
      days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d].sort((a, b) => a - b),
    }));
  }

  async function onSaveHours() {
    if (!hoursValid) return;
    setSavingHours(true);
    try {
      await saveSlaHours(hours);
      toast('Business hours saved');
    } catch {
      toast('Could not save business hours');
    } finally {
      setSavingHours(false);
    }
  }

  const valid = PRIORITIES.every(
    (p) => parseMins(draft[p].firstResponseMins) !== null && parseMins(draft[p].resolutionMins) !== null,
  );

  function set(p: TicketPriority, field: 'firstResponseMins' | 'resolutionMins', value: string) {
    setDraft((d) => ({ ...d, [p]: { ...d[p], [field]: value } }));
  }

  async function onSave() {
    const next = {} as SlaTargets;
    for (const p of PRIORITIES) {
      const first = parseMins(draft[p].firstResponseMins);
      const resolution = parseMins(draft[p].resolutionMins);
      if (first === null || resolution === null) return;
      next[p] = { firstResponseMins: first, resolutionMins: resolution };
    }
    try {
      await saveSlaTargets(next);
      toast('SLA targets saved');
    } catch {
      toast('Could not save SLA targets');
    }
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">SLA targets</h2>
      <p className="mt-2 text-[13px] text-text-3">
        Set the first response and resolution goals for each priority. Times are in minutes and drive
        the SLA clock on every ticket.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <div className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3 text-[12px] font-medium text-text-3">
          <span />
          <span>
            <Tooltip
              title="First-response SLA"
              label="The time you promise before an agent sends the first reply to a new ticket."
            >
              First response (min)
            </Tooltip>
          </span>
          <span>
            <Tooltip
              title="Resolution SLA"
              label="The time you promise before the ticket is fully resolved, from creation to solved."
            >
              Resolution (min)
            </Tooltip>
          </span>
        </div>
        {PRIORITIES.map((p) => (
          <div key={p} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3">
            <span className="text-[14px] font-medium">{PRIORITY_LABEL[p]}</span>
            <MinsField
              value={draft[p].firstResponseMins}
              onChange={(v) => set(p, 'firstResponseMins', v)}
              label={`${PRIORITY_LABEL[p]} first response in minutes`}
            />
            <MinsField
              value={draft[p].resolutionMins}
              onChange={(v) => set(p, 'resolutionMins', v)}
              label={`${PRIORITY_LABEL[p]} resolution in minutes`}
            />
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Button variant="primary" size="sm" disabled={!valid} onClick={() => void onSave()}>
          Save targets
        </Button>
      </div>

      <div className="my-8 border-t border-line" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Business hours</h2>
          <p className="mt-2 text-[13px] text-text-3">
            Pause SLA clocks outside working hours, so a ticket that arrives Friday evening is not
            marked overdue by Monday morning. When off, clocks run around the clock.
          </p>
        </div>
        <div className="mt-0.5 shrink-0">
          <Switch
            enabled={hours.enabled}
            onToggle={() => setHours((h) => ({ ...h, enabled: !h.enabled }))}
            label="Enable business hours"
          />
        </div>
      </div>

      <div className={cx('mt-5 flex flex-col gap-4', !hours.enabled && 'pointer-events-none opacity-50')}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Time zone</span>
          <input
            type="text"
            list="sla-timezones"
            aria-label="Time zone"
            value={hours.timezone}
            onChange={(e) => setHours((h) => ({ ...h, timezone: e.target.value }))}
            className="h-9 w-full max-w-xs rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2"
          />
          <datalist id="sla-timezones">
            {allZones().map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Working days</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = hours.days.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d.value)}
                  className={cx(
                    'h-8 w-12 rounded-md border text-[13px] font-medium transition-colors',
                    on
                      ? 'border-transparent bg-accent text-accent-fg'
                      : 'border-line text-text-2 hover:bg-surface-2',
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Start</span>
            <input
              type="time"
              aria-label="Working hours start"
              value={hours.start}
              onChange={(e) => setHours((h) => ({ ...h, start: e.target.value }))}
              className="h-9 rounded-md border border-line bg-bg px-2.5 text-[14px] tabular-nums outline-none focus:border-line-2"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">End</span>
            <input
              type="time"
              aria-label="Working hours end"
              value={hours.end}
              onChange={(e) => setHours((h) => ({ ...h, end: e.target.value }))}
              className="h-9 rounded-md border border-line bg-bg px-2.5 text-[14px] tabular-nums outline-none focus:border-line-2"
            />
          </label>
          {!hoursValid && (
            <span className="pb-2 text-[12px] text-red">End time must be after start.</span>
          )}
        </div>
      </div>

      <div className="mt-6">
        <Button variant="primary" size="sm" disabled={!hoursValid || savingHours} onClick={() => void onSaveHours()}>
          {savingHours ? 'Saving…' : 'Save business hours'}
        </Button>
      </div>
    </section>
  );
}
