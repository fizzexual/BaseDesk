import { useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import { useRevenueStats } from '../../data/hooks';
import { formatMoney } from '../../data/money';
import type { Deal, DealStage, DealType } from '../../data/types';
import { Button } from '../../components/Button';
import { Menu, type MenuItem } from '../../components/Menu';
import { cx } from '../../components/util';
import { IconFilter, IconPlus, IconSearch } from '../../icons';
import { DealDialog } from './DealDialog';
import { DealTable } from './DealTable';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line p-3.5">
      <div className="text-[12px] font-medium text-text-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const TYPE_LABELS: Record<DealType, string> = { expansion: 'Expansion', retention: 'Retention', inbound: 'Inbound' };
const STAGE_LABELS: Record<DealStage, string> = { open: 'Open', won: 'Won', lost: 'Lost' };

export function PipelineTab() {
  const deals = useApp((s) => s.deals);
  const contacts = useApp((s) => s.contacts);
  const { revenue } = useRevenueStats();

  const [typeFilter, setTypeFilter] = useState<DealType | null>(null);
  const [stageFilter, setStageFilter] = useState<DealStage | null>(null);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>(undefined);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(deals)
      .filter((d) => (typeFilter ? d.type === typeFilter : true))
      .filter((d) => (stageFilter ? d.stage === stageFilter : true))
      .filter((d) => {
        if (q === '') return true;
        const contact = contacts[d.contactId];
        return d.title.toLowerCase().includes(q) || (contact?.name.toLowerCase().includes(q) ?? false);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [deals, contacts, typeFilter, stageFilter, query]);

  const filterCount = (typeFilter ? 1 : 0) + (stageFilter ? 1 : 0);
  const filterItems: MenuItem[] = [
    { label: 'All types', checked: typeFilter === null, onSelect: () => setTypeFilter(null) },
    ...(['expansion', 'retention', 'inbound'] as DealType[]).map(
      (t): MenuItem => ({ label: TYPE_LABELS[t], checked: typeFilter === t, onSelect: () => setTypeFilter(t) }),
    ),
    { separator: true },
    { label: 'All stages', checked: stageFilter === null, onSelect: () => setStageFilter(null) },
    ...(['open', 'won', 'lost'] as DealStage[]).map(
      (s): MenuItem => ({ label: STAGE_LABELS[s], checked: stageFilter === s, onSelect: () => setStageFilter(s) }),
    ),
  ];

  function openNew() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-4 gap-3 p-4">
        <StatCard label="Won this month" value={formatMoney(revenue?.wonThisMonth ?? 0, { compact: true })} />
        <StatCard label="Open pipeline" value={formatMoney(revenue?.openPipeline ?? 0, { compact: true })} />
        <StatCard label="Saved revenue" value={formatMoney(revenue?.savedRevenue ?? 0, { compact: true })} />
        <StatCard label="Win rate" value={`${Math.round((revenue?.winRate ?? 0) * 100)}%`} />
      </div>

      <div className="flex items-center gap-2 border-b border-line px-4 pb-3">
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={query}
            aria-label="Search deals"
            placeholder="Search deals"
            className="h-8 w-56 rounded-md border border-line bg-bg pl-8 pr-2.5 text-[13px] outline-none focus:border-line-2"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Menu
          align="start"
          trigger={
            <span className={cx('inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium', filterCount > 0 ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2')}>
              <IconFilter size={15} />
              Filter{filterCount > 0 ? ` · ${filterCount}` : ''}
            </span>
          }
          items={filterItems}
        />
        <div className="flex-1" />
        <Button variant="primary" size="sm" onClick={openNew}>
          <IconPlus size={15} />
          New deal
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DealTable
          deals={visible}
          onEdit={(deal) => {
            setEditing(deal);
            setDialogOpen(true);
          }}
        />
      </div>

      <DealDialog open={dialogOpen} onClose={() => setDialogOpen(false)} deal={editing} />
    </div>
  );
}
