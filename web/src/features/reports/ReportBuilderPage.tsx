import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import type { CustomReport, ReportDimension, ReportMetric, ReportRange } from '../../data/types';
import { IconChart, IconPlus, IconTrash } from '../../icons';
import { HBars } from './charts/HBars';
import { DIMENSION_LABEL, METRIC_LABEL, RANGE_LABEL, formatMetricValue, runReport } from './runReport';

const METRICS: ReportMetric[] = ['volume', 'solved', 'resolution', 'csat'];
const DIMENSIONS: ReportDimension[] = ['day', 'agent', 'priority', 'status', 'category', 'tag'];
const RANGES: ReportRange[] = ['last_7', 'last_14', 'last_30', 'all'];
const BAR_COLOR = 'var(--blue)';
const SELECT = 'h-9 rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus:border-line-2';
const BLANK: CustomReport = { id: '', name: '', metric: 'volume', dimension: 'day', range: 'last_14' };

export function ReportBuilderPage() {
  const reports = useApp((s) => s.customReports);
  const tickets = useApp((s) => s.tickets);
  const agents = useApp((s) => s.agents);
  const saveReport = useApp((s) => s.saveReport);
  const deleteReport = useApp((s) => s.deleteReport);
  const [draft, setDraft] = useState<CustomReport>({ ...BLANK });
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => runReport(draft, Object.values(tickets), agents), [draft, tickets, agents]);
  // Day breakdowns keep every point; categorical ones cap at the top 20.
  const shown = draft.dimension === 'day' ? rows : rows.slice(0, 20);

  async function save() {
    if (draft.name.trim() === '' || busy) return;
    setBusy(true);
    try {
      const saved = await saveReport(draft);
      setDraft(saved);
      toast(draft.id ? 'Report updated' : 'Report saved');
    } catch {
      toast('Could not save the report');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteReport(id);
      if (draft.id === id) setDraft({ ...BLANK });
      toast('Report deleted');
    } catch {
      toast('Could not delete the report');
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-text-3">Saved reports</span>
          <button
            type="button"
            onClick={() => setDraft({ ...BLANK })}
            aria-label="New report"
            className="inline-flex size-6 items-center justify-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <IconPlus size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {reports.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-text-3">No saved reports yet. Build one and save it.</p>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className={cx('group flex items-center gap-1 rounded-md', draft.id === r.id ? 'bg-surface-3' : 'hover:bg-surface-2')}
              >
                <button type="button" onClick={() => setDraft({ ...r })} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                  <span className="block truncate text-[13px] font-medium">{r.name}</span>
                  <span className="block truncate text-[11px] text-text-3">
                    {METRIC_LABEL[r.metric]} · {DIMENSION_LABEL[r.dimension]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  aria-label={`Delete ${r.name}`}
                  className="mr-1 shrink-0 rounded-sm p-1 text-text-3 opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        <header className="mb-4 flex items-baseline gap-2.5">
          <h1 className="text-[15px] font-semibold text-text">Report builder</h1>
          <Link to="/reports" className="text-[13px] text-text-3 transition-colors hover:text-text">
            ← Reports
          </Link>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-3">Metric</span>
            <select className={SELECT} value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as ReportMetric })}>
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-3">Break down by</span>
            <select className={SELECT} value={draft.dimension} onChange={(e) => setDraft({ ...draft, dimension: e.target.value as ReportDimension })}>
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-text-3">Range</span>
            <select className={SELECT} value={draft.range} onChange={(e) => setDraft({ ...draft, range: e.target.value as ReportRange })}>
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[12px] text-text-3">Name</span>
            <input
              className={cx(SELECT, 'w-full placeholder:text-text-3')}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name this report to save it"
            />
          </label>
          <Button size="sm" disabled={draft.name.trim() === '' || busy} onClick={() => void save()}>
            {draft.id ? 'Update' : 'Save'}
          </Button>
        </div>

        <section className="mt-5 rounded-md border border-line p-4">
          <h2 className="mb-3 text-[13px] font-medium text-text">
            {METRIC_LABEL[draft.metric]} by {DIMENSION_LABEL[draft.dimension].toLowerCase()}{' '}
            <span className="text-text-3">· {RANGE_LABEL[draft.range]}</span>
          </h2>
          {shown.length === 0 ? (
            <EmptyState icon={<IconChart size={28} />} title="No data in range" hint="Widen the range or pick a different breakdown." />
          ) : (
            <HBars
              rows={shown.map((r) => ({ key: r.key, label: r.label, count: r.value, color: BAR_COLOR }))}
              labelWidth="w-28"
              valueWidth="w-14"
              formatValue={(n) => formatMetricValue(draft.metric, n)}
            />
          )}
        </section>
      </div>
    </div>
  );
}
