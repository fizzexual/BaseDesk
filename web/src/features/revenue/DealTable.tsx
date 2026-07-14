import { Link } from 'react-router';
import { useApp } from '../../data/store';
import type { Deal } from '../../data/types';
import { formatMoney } from '../../data/money';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { Tooltip } from '../../components/Tooltip';
import { DealStageBadge, DealTypeBadge } from '../../components/DealBadges';
import { cx } from '../../components/util';
import { IconRevenue } from '../../icons';

const GRID = 'grid-cols-[minmax(160px,1.3fr)_minmax(0,2fr)_110px_90px_120px_70px]';

export function DealTable({ deals, onEdit }: { deals: Deal[]; onEdit: (deal: Deal) => void }) {
  const contacts = useApp((s) => s.contacts);
  const agents = useApp((s) => s.agents);

  if (deals.length === 0) {
    return <EmptyState icon={IconRevenue} title="No deals here" hint="Deals you log will show up in the pipeline." />;
  }

  return (
    <div>
      <div className={cx('grid h-9 items-center gap-4 border-b border-line px-4 text-[13px] text-text-3', GRID)}>
        <div>Customer</div>
        <div>
          <Tooltip
            title="Deal types"
            label="Expansion — upsell to an existing account. Retention — an at-risk account saved from churn. Inbound — a new deal sourced from a support conversation."
          >
            <span>Deal</span>
          </Tooltip>
        </div>
        <div className="text-right">Value</div>
        <div>Stage</div>
        <div>Owner</div>
        <div className="text-right">Updated</div>
      </div>
      {deals.map((deal) => {
        const contact = contacts[deal.contactId];
        const owner = agents[deal.ownerId];
        return (
          <button
            key={deal.id}
            type="button"
            className={cx('grid h-16 w-full items-center gap-4 border-b border-line px-4 text-left last:border-0 hover:bg-surface-2', GRID)}
            onClick={() => onEdit(deal)}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {contact && <Avatar name={contact.name} hue={contact.avatarHue} size={28} />}
              <span className="truncate text-[14px] font-medium">{contact?.name ?? 'Unknown'}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <DealTypeBadge type={deal.type} />
              <span className="truncate text-[14px]">{deal.title}</span>
            </div>
            <div className="text-right text-[14px] font-medium tabular-nums">{formatMoney(deal.value)}</div>
            <div><DealStageBadge stage={deal.stage} /></div>
            <div className="truncate text-[13px] text-text-2">{owner?.name ?? '—'}</div>
            <div className="text-right">
              {deal.ticketId !== null ? (
                <Link
                  to={`/ticket/${deal.ticketId}`}
                  className="text-[13px] text-text-3 hover:text-text"
                  onClick={(e) => e.stopPropagation()}
                >
                  <TimeAgo iso={deal.updatedAt} />
                </Link>
              ) : (
                <TimeAgo iso={deal.updatedAt} />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
