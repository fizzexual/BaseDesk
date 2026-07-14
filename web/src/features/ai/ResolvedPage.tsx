import { useMemo } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { TimeAgo } from '../../components/TimeAgo';
import { Tooltip } from '../../components/Tooltip';
import { TokenCost } from './TokenCost';
import { IconCheckCircle, IconSparkle } from '../../icons';

export function ResolvedPage() {
  const aiActions = useApp((s) => s.aiActions);
  const tickets = useApp((s) => s.tickets);
  const contacts = useApp((s) => s.contacts);
  const aiAgents = useApp((s) => s.aiAgents);
  const kb = useApp((s) => s.kb);

  const resolved = useMemo(
    () =>
      Object.values(aiActions)
        .filter((a) => a.kind === 'resolve')
        .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt)),
    [aiActions],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <h1 className="text-[15px] font-semibold">Resolved by AI</h1>
        {resolved.length > 0 && (
          <span className="text-[13px] text-text-3 tabular-nums">{resolved.length}</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {resolved.length === 0 ? (
          <EmptyState
            icon={IconCheckCircle}
            title="Nothing resolved by AI yet"
            hint="Tickets your agents answer on their own will appear here."
          />
        ) : (
          resolved.map((action) => {
            const ticket = tickets[action.ticketId];
            if (!ticket) return null;
            const requester = contacts[ticket.requesterId];
            const agent = aiAgents[action.agentId];
            const article = action.kbArticleId !== null ? kb[action.kbArticleId] : undefined;
            return (
              <div key={action.id} className="flex items-center gap-3 border-b border-line p-4">
                <Avatar name={requester?.name ?? 'Unknown'} hue={requester?.avatarHue ?? 0} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      to={`/ticket/${ticket.id}`}
                      className="min-w-0 truncate text-[14px] font-medium hover:underline"
                    >
                      {ticket.subject}
                    </Link>
                    <StatusBadge status={ticket.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-text-3">
                    <IconSparkle size={13} className="shrink-0" />
                    <span className="truncate">{agent?.name ?? 'Agent'}</span>
                    {article !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <Tooltip
                          title="Knowledge-base match"
                          label="This reply was generated straight from a knowledge-base article the AI matched with high confidence — not just drafted for review."
                        >
                          <span>cited</span>
                        </Tooltip>
                        <Link to={`/kb/${article.id}`} className="font-medium text-text-2 hover:underline">
                          {article.title}
                        </Link>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <Tooltip title="AI cost" label="Tokens used and the estimated price for this generation, based on your configured AI model.">
                      <TokenCost promptTokens={action.promptTokens} completionTokens={action.completionTokens} />
                    </Tooltip>
                  </div>
                </div>
                <TimeAgo iso={action.resolvedAt ?? action.createdAt} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
