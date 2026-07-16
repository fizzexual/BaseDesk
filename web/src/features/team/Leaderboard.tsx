import { useMemo } from 'react';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { Tooltip } from '../../components/Tooltip';
import { weeklyLeaderboard } from './scores';

const MEDAL = ['🥇', '🥈', '🥉'];

/** A friendly weekly leaderboard: points for solving, happy customers, and fast
 *  first responses, with badges for the leaders. Derived live from tickets. */
export function Leaderboard() {
  const tickets = useApp((s) => s.tickets);
  const agents = useApp((s) => s.agents);

  const board = useMemo(() => {
    const activeIds = Object.values(agents).filter((a) => a.status === 'active').map((a) => a.id);
    return weeklyLeaderboard(Object.values(tickets), activeIds, Date.now())
      .filter((s) => s.points !== 0 || s.solved > 0)
      .slice(0, 8);
  }, [tickets, agents]);

  if (board.length === 0) return null;

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Leaderboard</h2>
        <span className="text-[12px] text-text-3">this week · 10 pts a solve, ±CSAT, +5 fast reply</span>
      </div>
      <ol className="flex flex-col divide-y divide-line">
        {board.map((s, i) => {
          const agent = agents[s.agentId];
          if (agent === undefined) return null;
          return (
            <li key={s.agentId} className="flex items-center gap-3 py-2">
              <span className="w-6 shrink-0 text-center text-[15px] leading-none">
                {i < 3 ? MEDAL[i] : <span className="text-[13px] text-text-3">{i + 1}</span>}
              </span>
              <Avatar name={agent.name} hue={agent.avatarHue} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-medium">{agent.name}</span>
                  {s.badges.map((b) => (
                    <Tooltip key={b} label={b}>
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] leading-none">{b.split(' ')[0]}</span>
                    </Tooltip>
                  ))}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-text-3">
                  <span>{s.solved} solved</span>
                  {s.avgCsat !== null && <span>{s.avgCsat.toFixed(1)}★ CSAT</span>}
                  {s.fastResponses > 0 && <span>{s.fastResponses} fast {s.fastResponses === 1 ? 'reply' : 'replies'}</span>}
                </div>
              </div>
              <span className="shrink-0 text-[15px] font-semibold tabular-nums text-accent">
                {s.points}
                <span className="ml-1 text-[11px] font-normal text-text-3">pts</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
