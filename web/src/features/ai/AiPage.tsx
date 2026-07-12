import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { IconFilter, IconNote, IconReply, IconSparkle } from '../../icons';
import { AI_MODULES, getApiKey } from './engine';

// AI_MODULES keys map to the icon that represents each capability.
const MODULE_ICONS: Record<string, (p: { size?: number; className?: string }) => React.ReactNode> = {
  draft: IconReply,
  triage: IconFilter,
  summary: IconNote,
};

export function AiPage() {
  const navigate = useNavigate();
  const hasKey = getApiKey() !== null;

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
    </div>
  );
}
