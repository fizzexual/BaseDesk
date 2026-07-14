import { useNavigate } from 'react-router';
import { useAccounts } from '../../data/hooks';
import { formatMoney } from '../../data/money';
import type { AccountHealth } from '../../data/types';
import { EmptyState } from '../../components/EmptyState';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconContacts } from '../../icons';

const GRID = 'grid-cols-[minmax(160px,1.6fr)_110px_140px_110px_110px_90px]';

const HEALTH: Record<AccountHealth['status'], { label: string; className: string }> = {
  at_risk: { label: 'At risk', className: 'bg-red-bg text-red' },
  expansion_ready: { label: 'Expansion-ready', className: 'bg-blue-bg text-blue' },
  healthy: { label: 'Healthy', className: 'bg-green-bg text-green' },
};

export function AccountsTab() {
  const navigate = useNavigate();
  const accounts = useAccounts();

  if (accounts.length === 0) {
    return <EmptyState icon={IconContacts} title="No accounts yet" hint="Companies with contacts will appear here." />;
  }

  function openCompany(account: AccountHealth) {
    const first = account.contactIds[0];
    if (first !== undefined) navigate(`/contacts/${first}`);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx('grid h-9 items-center gap-4 border-b border-line px-4 text-[13px] text-text-3', GRID)}>
        <div>Company</div>
        <div className="text-right">
          <Tooltip title="MRR" label="Monthly recurring revenue — this account's current subscription value per month.">
            <span>MRR</span>
          </Tooltip>
        </div>
        <div>
          <Tooltip
            title="Account health"
            label="At risk: an urgent ticket is open, or a retention deal is in progress. Expansion-ready: no risk, but an upsell deal is open. Healthy: neither."
          >
            <span>Health</span>
          </Tooltip>
        </div>
        <div className="text-right">Won</div>
        <div className="text-right">
          <Tooltip title="Pipeline" label="Total value of this account's deals still open — not yet won or lost.">
            <span>Pipeline</span>
          </Tooltip>
        </div>
        <div className="text-right">Open</div>
      </div>
      {accounts.map((account) => {
        const health = HEALTH[account.status];
        return (
          <button
            key={account.company}
            type="button"
            className={cx('grid h-14 w-full items-center gap-4 border-b border-line px-4 text-left last:border-0 hover:bg-surface-2', GRID)}
            onClick={() => openCompany(account)}
          >
            <span className="truncate text-[14px] font-medium">{account.company}</span>
            <span className="text-right text-[13px] tabular-nums text-text-2">
              {account.mrr > 0 ? `${formatMoney(account.mrr, { compact: true })}/mo` : '—'}
            </span>
            <span>
              <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium', health.className)}>
                {health.label}
              </span>
            </span>
            <span className="text-right text-[13px] tabular-nums text-text-2">{formatMoney(account.wonValue, { compact: true })}</span>
            <span className="text-right text-[13px] tabular-nums text-text-2">{formatMoney(account.openPipeline, { compact: true })}</span>
            <span className="text-right text-[13px] tabular-nums text-text-2">{account.openTickets}</span>
          </button>
        );
      })}
    </div>
  );
}
