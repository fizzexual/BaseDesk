import { Avatar } from '../../components/Avatar';
import { useApp } from '../../data/store';

export function Profile() {
  const agent = useApp((s) => s.agents[s.currentAgentId]);
  if (!agent) return null;

  return (
    <section>
      <h2 className="text-[15px] font-semibold">Profile</h2>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-line p-4">
        <Avatar name={agent.name} hue={agent.avatarHue} size={36} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{agent.name}</span>
            <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface-2 px-2 text-[11px] font-medium uppercase text-text-2">
              {agent.role}
            </span>
          </div>
          <div className="truncate text-[13px] text-text-3">{agent.email}</div>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-text-3">
        Accounts and team management arrive in v0.2. BaseDesk v0.1 runs as a single-team
        workspace.
      </p>
    </section>
  );
}
