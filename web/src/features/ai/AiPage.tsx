import { IconFilter, IconNote, IconReply, IconSparkle } from '../../icons';

const CAPABILITIES = [
  {
    icon: IconNote,
    title: 'Reply drafts',
    detail: 'grounded in the conversation and your canned replies',
  },
  {
    icon: IconFilter,
    title: 'Auto-triage',
    detail: 'priority, tags and routing suggestions',
  },
  {
    icon: IconReply,
    title: 'Summaries',
    detail: 'instant context on handoff',
  },
];

export function AiPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[520px] px-6 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-text-2">
          <IconSparkle size={28} />
        </div>
        <h1 className="mt-5 text-[18px] font-semibold">
          AI that helps agents, not gatekeeps customers
        </h1>
        <p className="mt-2 text-[14px] text-text-2">
          BaseDesk will ship an agent-side copilot: reply drafts, thread summaries, and triage
          suggestions — always reviewed by a human before anything reaches a customer.
        </p>
        <div className="mt-8 flex flex-col gap-2 text-left">
          {CAPABILITIES.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.title} className="flex items-start gap-3 rounded-md border border-line p-3.5">
                <Icon size={18} className="mt-px shrink-0 text-text-2" />
                <div className="text-[14px]">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-text-2"> — {c.detail}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-[13px] text-text-3">
          Bring your own API key in v0.2. No per-resolution pricing. Opt-in, always.
        </p>
      </div>
    </div>
  );
}
