import { useEffect, useState } from 'react';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { Tooltip } from '../../components/Tooltip';

// One id per browser tab, so two windows count as two viewers even under a single
// login. Generated once at module load.
const SESSION_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/** Poll ticket presence every few seconds; returns the agent ids of other viewers. */
function usePresence(ticketId: string): string[] {
  const heartbeat = useApp((s) => s.heartbeatPresence);
  const [present, setPresent] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const ping = () =>
      heartbeat(ticketId, SESSION_ID)
        .then((p) => {
          if (alive) setPresent(p);
        })
        .catch(() => {});
    void ping();
    const id = setInterval(() => void ping(), 6_000);
    return () => {
      alive = false;
      clearInterval(id);
      setPresent([]);
    };
  }, [ticketId, heartbeat]);
  return present;
}

/** "Also viewing" indicator: overlapping avatars of anyone else on this ticket. */
export function PresenceBar({ ticketId }: { ticketId: string }) {
  const present = usePresence(ticketId);
  const agents = useApp((s) => s.agents);
  if (present.length === 0) return null;
  const people = present.map((id) => agents[id]).filter((a): a is NonNullable<typeof a> => a !== undefined);
  if (people.length === 0) return null;
  const names = people.map((p) => p.name).join(', ');
  return (
    <Tooltip label={`${names} also viewing this ticket — coordinate before you reply`}>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex -space-x-2">
          {people.slice(0, 3).map((p) => (
            <span key={p.id} className="rounded-full ring-2 ring-bg">
              <Avatar name={p.name} hue={p.avatarHue} size={22} />
            </span>
          ))}
        </div>
        <span className="text-[12px] font-medium" style={{ color: 'var(--amber)' }}>
          Also viewing
        </span>
      </div>
    </Tooltip>
  );
}
