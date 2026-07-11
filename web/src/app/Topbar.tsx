import { useRevenueStats } from '../data/hooks';
import { formatMoney } from '../data/money';
import { Kbd } from '../components/Kbd';
import { IconRevenue, IconSearch } from '../icons';
import { MOD_LABEL, openPalette } from '../features/palette/shortcuts';

export function Topbar() {
  const { revenue } = useRevenueStats();
  const wonThisWeek = revenue?.wonLast7Days ?? 0;

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between pr-3">
      <div className="inline-flex h-8 items-center gap-2 rounded-full bg-green-bg px-3 text-[13px] font-medium text-green">
        <IconRevenue size={15} />
        <span className="tabular-nums">{formatMoney(wonThisWeek, { compact: true })} closed this week</span>
      </div>

      <button
        type="button"
        className="flex h-9 w-80 items-center gap-2.5 rounded-md border border-line bg-surface px-3 text-[13px] text-text-3 shadow-1 transition-colors hover:border-line-2"
        onClick={openPalette}
      >
        <IconSearch size={16} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>{MOD_LABEL} K</Kbd>
      </button>
    </header>
  );
}
