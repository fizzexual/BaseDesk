import { useRevenueStats } from '../data/hooks';
import { useApp } from '../data/store';
import { currentOnCall } from '../data/oncall';
import { formatMoney } from '../data/money';
import { Avatar } from '../components/Avatar';
import { Kbd } from '../components/Kbd';
import { Tooltip } from '../components/Tooltip';
import { IconBell, IconRevenue, IconSearch } from '../icons';
import { MOD_LABEL, openPalette } from '../features/palette/shortcuts';
import { NotificationBell } from './NotificationBell';

/** Shows who's currently on call, when a rotation is enabled. */
function OnCallChip() {
  const config = useApp((s) => s.onCall);
  const agents = useApp((s) => s.agents);
  const id = currentOnCall(config);
  const agent = id !== null ? agents[id] : undefined;
  if (agent === undefined) return null;
  return (
    <Tooltip title="On call" label="The agent currently on call for urgent tickets. Set the rotation in Settings → On-call.">
      <div className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px]">
        <IconBell size={14} className="text-text-3" />
        <span className="text-text-3">On call</span>
        <Avatar name={agent.name} hue={agent.avatarHue} size={18} />
        <span className="font-medium">{agent.name}</span>
      </div>
    </Tooltip>
  );
}

export function Topbar() {
  const { revenue } = useRevenueStats();
  const wonThisWeek = revenue?.wonLast7Days ?? 0;

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between pr-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex h-8 items-center gap-2 rounded-full bg-green-bg px-3 text-[13px] font-medium text-green">
          <IconRevenue size={15} />
          <span className="tabular-nums">{formatMoney(wonThisWeek, { compact: true })} closed this week</span>
        </div>
        <OnCallChip />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 w-80 items-center gap-2.5 rounded-md border border-line bg-surface px-3 text-[13px] text-text-3 shadow-1 transition-colors hover:border-line-2"
          onClick={openPalette}
        >
          <IconSearch size={16} />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>{MOD_LABEL} K</Kbd>
        </button>
        <NotificationBell />
      </div>
    </header>
  );
}
