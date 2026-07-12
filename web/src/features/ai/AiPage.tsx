import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { AiAgent, Autonomy, TicketPriority } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconFilter, IconNote, IconPlay, IconPlus, IconReply, IconSparkle } from '../../icons';
import { AI_MODULES, getApiKey } from './engine';
import { AgentEditor } from './AgentEditor';

// AI_MODULES keys map to the icon that represents each capability.
const MODULE_ICONS: Record<string, (p: { size?: number; className?: string }) => React.ReactNode> = {
  draft: IconReply,
  triage: IconFilter,
  summary: IconNote,
};

const AUTONOMY_META: Record<Autonomy, { label: string; className: string }> = {
  suggest: { label: 'Suggest', className: 'bg-surface-2 text-text-2' },
  draft: { label: 'Draft', className: 'bg-blue-bg text-blue' },
  resolve: { label: 'Resolve', className: 'bg-green-bg text-green' },
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function scopeSummary(agent: AiAgent): string {
  const parts: string[] = [];
  if (agent.scopeTags.length > 0) parts.push(agent.scopeTags.join(', '));
  if (agent.scopePriorities.length > 0) {
    parts.push(`${agent.scopePriorities.map((p) => PRIORITY_LABEL[p]).join(', ')} priority`);
  }
  return parts.length === 0 ? 'All tickets' : parts.join(' · ');
}

function Switch({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        enabled ? 'bg-green' : 'bg-surface-3',
      )}
    >
      <span
        className={cx(
          'inline-block h-4 w-4 rounded-full bg-white shadow-1 transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function AgentCard({
  agent,
  pending,
  resolved,
  onEdit,
  onToggle,
}: {
  agent: AiAgent;
  pending: number;
  resolved: number;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const meta = AUTONOMY_META[agent.autonomy];
  return (
    <div className="flex items-center gap-3 rounded-md border border-line p-3.5">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onEdit}>
        <Avatar name={agent.name} hue={agent.avatarHue} size={36} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium">{agent.name}</span>
            <span
              className={cx(
                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-medium',
                meta.className,
              )}
            >
              {meta.label}
            </span>
            {!agent.enabled && (
              <span className="shrink-0 text-[12px] text-text-3">Off</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-text-3">{scopeSummary(agent)}</div>
          <div className="mt-0.5 text-[13px] text-text-3 tabular-nums">
            {pending} draft{pending === 1 ? '' : 's'} pending · {resolved} resolved
          </div>
        </div>
      </button>
      <Switch
        enabled={agent.enabled}
        onToggle={onToggle}
        label={`${agent.enabled ? 'Disable' : 'Enable'} ${agent.name}`}
      />
    </div>
  );
}

export function AiPage() {
  const navigate = useNavigate();
  const hasKey = getApiKey() !== null;

  const aiAgents = useApp((s) => s.aiAgents);
  const aiActions = useApp((s) => s.aiActions);
  const runAgents = useApp((s) => s.runAgents);
  const updateAiAgent = useApp((s) => s.updateAiAgent);

  const [editor, setEditor] = useState<{ agent?: AiAgent } | null>(null);
  const [running, setRunning] = useState(false);

  const agents = useMemo(
    () => Object.values(aiAgents).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [aiAgents],
  );

  const statsByAgent = useMemo(() => {
    const map: Record<string, { pending: number; resolved: number }> = {};
    for (const a of Object.values(aiActions)) {
      const entry = (map[a.agentId] ??= { pending: 0, resolved: 0 });
      if (a.kind === 'draft' && a.status === 'pending') entry.pending += 1;
      if (a.kind === 'resolve') entry.resolved += 1;
    }
    return map;
  }, [aiActions]);

  async function onRun() {
    if (running) return;
    setRunning(true);
    try {
      const n = await runAgents();
      toast(n === 0 ? 'No new tickets to process' : `${n} ticket${n === 1 ? '' : 's'} processed`);
    } catch {
      toast('Could not run the agents');
    } finally {
      setRunning(false);
    }
  }

  async function onToggle(agent: AiAgent) {
    try {
      await updateAiAgent(agent.id, { enabled: !agent.enabled });
    } catch {
      toast('Could not update the agent');
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[560px] px-6 py-12">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-text-2">
            <IconSparkle size={28} />
          </div>
          <h1 className="mt-5 text-[18px] font-semibold">Your support copilot</h1>
          <p className="mt-2 text-[14px] text-text-2">
            It runs locally with no setup — rule-based drafts, triage and summaries that you review
            before anything happens. Connect a model provider when you want smarter output.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-2">
          {AI_MODULES.map((m) => {
            const Icon = MODULE_ICONS[m.key] ?? IconSparkle;
            return (
              <div key={m.key} className="flex items-start gap-3 rounded-md border border-line p-3.5">
                <Icon size={18} className="mt-px shrink-0 text-text-2" />
                <div className="min-w-0">
                  <div className="text-[14px] font-medium">{m.title}</div>
                  <div className="mt-0.5 text-[13px] text-text-2">{m.body}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[13px] text-text-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-green" aria-hidden="true" />
            {hasKey ? 'Model provider connected' : 'Active — rule-based, no key required'}
          </span>
          <Button variant="subtle" size="sm" onClick={() => navigate('/settings/ai')}>
            Configure in Settings
          </Button>
        </div>

        <p className="mt-6 text-center text-[13px] text-text-3">
          Human-in-the-loop by design. Nothing is sent or changed without your click. No
          per-resolution pricing.
        </p>
      </div>

      <div className="mx-auto max-w-[720px] px-6 pb-16">
        <div className="border-t border-line pt-10">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold">Your agents</h2>
            <div className="flex items-center gap-2">
              <Button variant="subtle" size="sm" disabled={running} onClick={() => void onRun()}>
                <IconPlay size={15} />
                Run agents now
              </Button>
              <Button variant="primary" size="sm" onClick={() => setEditor({})}>
                <IconPlus size={15} />
                New agent
              </Button>
            </div>
          </div>

          {agents.length === 0 ? (
            <EmptyState
              icon={IconSparkle}
              title="No agents yet"
              hint="Create an agent to triage, draft, or resolve tickets automatically."
            />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {agents.map((agent) => {
                const stats = statsByAgent[agent.id] ?? { pending: 0, resolved: 0 };
                return (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    pending={stats.pending}
                    resolved={stats.resolved}
                    onEdit={() => setEditor({ agent })}
                    onToggle={() => void onToggle(agent)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editor !== null && (
        <AgentEditor
          key={editor.agent?.id ?? 'new'}
          open
          onClose={() => setEditor(null)}
          agent={editor.agent}
        />
      )}
    </div>
  );
}
