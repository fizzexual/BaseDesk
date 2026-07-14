import { useMemo } from 'react';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { Menu, type MenuItem } from '../../components/Menu';
import { Tooltip } from '../../components/Tooltip';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import type { Agent, Ticket } from '../../data/types';
import { IconBell, IconPlus, IconX } from '../../icons';

/**
 * Followers (watchers) of a ticket. Anyone here is notified of new customer
 * replies even when they aren't the assignee. Agents auto-follow tickets they
 * reply to; this panel lets them follow/unfollow and add teammates as watchers.
 */
export function TicketFollowers({ ticket }: { ticket: Ticket }) {
  const followers = useApp((s) => s.ticketFollowers[ticket.id]) ?? [];
  const currentAgentId = useApp((s) => s.currentAgentId);
  const agents = useApp((s) => s.agents);
  const follow = useApp((s) => s.followTicket);
  const unfollow = useApp((s) => s.unfollowTicket);

  const iFollow = followers.some((f) => f.agentId === currentAgentId);
  const followerIds = useMemo(() => new Set(followers.map((f) => f.agentId)), [followers]);

  // Active teammates not already watching — offered in the "add watcher" menu.
  const addable: Agent[] = useMemo(
    () =>
      Object.values(agents)
        .filter((a) => a.status === 'active' && !followerIds.has(a.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agents, followerIds],
  );

  async function toggleSelf() {
    try {
      if (iFollow) await unfollow(ticket.id, currentAgentId);
      else await follow(ticket.id);
    } catch {
      toast('Could not update your following status');
    }
  }

  const addItems: MenuItem[] = addable.map((a) => ({
    label: a.name,
    icon: <Avatar name={a.name} hue={a.avatarHue} size={18} />,
    onSelect: () => void follow(ticket.id, a.id).catch(() => toast('Could not add watcher')),
  }));

  return (
    <section className="border-t border-line p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">
          <Tooltip
            title="Followers"
            label="Agents watching this ticket are notified of new customer replies, even when they aren't the assignee."
          >
            <span>Followers</span>
          </Tooltip>
        </h3>
        <button
          type="button"
          onClick={() => void toggleSelf()}
          className={cx(
            'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium transition-colors',
            iFollow ? 'text-accent hover:bg-surface-2' : 'text-text-2 hover:bg-surface-2 hover:text-text',
          )}
        >
          <IconBell size={13} />
          {iFollow ? 'Following' : 'Follow'}
        </button>
      </div>

      {followers.length === 0 ? (
        <p className="text-[13px] text-text-3">No one is following this ticket yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {followers.map((f) => (
            <li key={f.agentId} className="group flex items-center gap-2">
              <Avatar name={f.name} hue={f.avatarHue} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {f.name}
                {f.agentId === currentAgentId && <span className="text-text-3"> (you)</span>}
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => void unfollow(ticket.id, f.agentId).catch(() => toast('Could not remove follower'))}
                className="shrink-0 rounded-sm p-0.5 text-text-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
              >
                <IconX size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {addable.length > 0 && (
        <Menu
          align="start"
          triggerLabel="Add a watcher"
          triggerClassName="mt-2 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          trigger={
            <>
              <IconPlus size={13} />
              Add watcher
            </>
          }
          items={addItems}
        />
      )}
    </section>
  );
}
