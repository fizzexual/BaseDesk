import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { TimeAgo } from '../../components/TimeAgo';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconCheckCircle } from '../../icons';
import type { Ticket } from '../../data/types';

interface Participant {
  id: string;
  name: string;
  hue: number;
  role: string;
}

/**
 * "In this conversation": everyone on the thread (the customer + agents who've
 * replied or are assigned) with a read receipt — when they last viewed it and
 * whether that was after the newest message.
 */
export function ConversationParticipants({ ticket }: { ticket: Ticket }) {
  const messages = useApp((s) => s.messages[ticket.id]);
  const seen = useApp((s) => s.ticketSeen[ticket.id]);
  const contacts = useApp((s) => s.contacts);
  const agents = useApp((s) => s.agents);
  const currentAgentId = useApp((s) => s.currentAgentId);

  const msgs = messages ?? [];
  // What "seen the latest" is measured against.
  const lastAt = msgs.reduce((max, m) => (m.at > max ? m.at : max), ticket.lastMessageAt);

  const agentIds = new Set<string>();
  for (const m of msgs) if (m.authorKind === 'agent') agentIds.add(m.authorId);
  if (ticket.assigneeId !== null) agentIds.add(ticket.assigneeId);

  const requester = contacts[ticket.requesterId];
  const participants: Participant[] = [
    ...(requester ? [{ id: requester.id, name: requester.name, hue: requester.avatarHue, role: 'Customer' }] : []),
    ...[...agentIds]
      .map((id) => agents[id])
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .map((a) => ({ id: a.id, name: a.name, hue: a.avatarHue, role: a.id === ticket.assigneeId ? 'Assignee' : 'Agent' })),
  ];
  if (participants.length === 0) return null;

  const seenAtOf = (id: string): string | null => {
    if (id === currentAgentId) return new Date().toISOString(); // you're looking at it right now
    return seen?.find((s) => s.viewerId === id)?.at ?? null;
  };

  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">In this conversation</h3>
      <ul className="flex flex-col gap-2.5">
        {participants.map((p) => {
          const seenAt = seenAtOf(p.id);
          const sawLatest = seenAt !== null && seenAt >= lastAt;
          return (
            <li key={p.id} className="flex items-center gap-2.5">
              <Avatar name={p.name} hue={p.hue} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{p.name}</div>
                <div className="text-[11px] text-text-3">{p.role}</div>
              </div>
              {seenAt === null ? (
                <span className="shrink-0 text-[11px] text-text-3">Not seen yet</span>
              ) : (
                <Tooltip
                  title={sawLatest ? 'Up to date' : 'Behind'}
                  label={sawLatest ? 'Has seen the latest message.' : "Last viewed before the newest message — hasn't seen it yet."}
                >
                  <span className={cx('inline-flex shrink-0 items-center gap-1 text-[11px]', sawLatest ? 'text-green' : 'text-text-3')}>
                    {sawLatest && <IconCheckCircle size={12} className="shrink-0" />}
                    <TimeAgo iso={seenAt} />
                  </span>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
