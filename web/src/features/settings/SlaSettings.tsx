import { useState } from 'react';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';
import type { SlaTargets, TicketPriority } from '../../data/types';

const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];

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
  const [draft, setDraft] = useState<SlaDraft>(() => toDraft(sla));

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
          <span>First response (min)</span>
          <span>Resolution (min)</span>
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
    </section>
  );
}
