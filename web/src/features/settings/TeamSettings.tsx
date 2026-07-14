import { useMemo, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Menu } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { Agent } from '../../data/types';
import { IconDots, IconPlus } from '../../icons';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

const ROLE_OPTIONS: { value: 'agent' | 'admin'; label: string }[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'admin', label: 'Admin' },
];

function inviteUrl(token: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://your-basedesk';
  return `${origin}/invite/${token}`;
}

function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(token);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Could not copy link');
    }
  }
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md bg-surface-2 p-1.5 pl-2.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-2">{url}</span>
      <Button variant="subtle" size="sm" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inviteAgent = useApp((s) => s.inviteAgent);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');
  const [sending, setSending] = useState(false);

  const valid = name.trim() !== '' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function reset() {
    setName('');
    setEmail('');
    setRole('agent');
  }

  async function onSend() {
    if (!valid) return;
    setSending(true);
    try {
      await inviteAgent({ name: name.trim(), email: email.trim(), role });
      toast('Invitation created');
      reset();
      onClose();
    } catch {
      toast('Could not create invitation');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Invite a teammate">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Rivera" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@company.com" className={FIELD} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Role</span>
          <SegmentedControl options={ROLE_OPTIONS} value={role} onChange={setRole} />
          <span className="text-[12px] text-text-3">
            {role === 'admin'
              ? 'Admins manage the workspace, team, and all settings.'
              : 'Agents work tickets but cannot change workspace settings.'}
          </span>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="subtle" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!valid || sending} onClick={() => void onSend()}>
          {sending ? 'Inviting…' : 'Send invite'}
        </Button>
      </div>
    </Dialog>
  );
}

function MemberRow({ agent, activeAdmins, isSelf }: { agent: Agent; activeAdmins: number; isSelf: boolean }) {
  const updateAgent = useApp((s) => s.updateAgent);
  const deleteAgent = useApp((s) => s.deleteAgent);
  const categories = useApp((s) => s.categories);
  const lastAdmin = agent.role === 'admin' && agent.status === 'active' && activeAdmins <= 1;

  async function setRole(role: 'admin' | 'agent') {
    if (role === agent.role) return;
    try {
      await updateAgent(agent.id, { role });
      toast(`${agent.name} is now ${role === 'admin' ? 'an admin' : 'an agent'}`);
    } catch {
      toast('Could not change role');
    }
  }

  async function remove() {
    try {
      await deleteAgent(agent.id);
      toast(`Removed ${agent.name}`);
    } catch {
      toast('Could not remove — a workspace needs at least one admin');
    }
  }

  async function toggleCategory(category: string) {
    const next = agent.categories.includes(category)
      ? agent.categories.filter((c) => c !== category)
      : [...agent.categories, category];
    try {
      await updateAgent(agent.id, { categories: next });
    } catch {
      toast('Could not update categories');
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-3">
        <Avatar name={agent.name} hue={agent.avatarHue} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{agent.name}</span>
            {isSelf && <span className="shrink-0 text-[12px] text-text-3">You</span>}
          </div>
          <div className="truncate text-[13px] text-text-3">{agent.email}</div>
        </div>

        <span
          className={cx(
            'inline-flex h-[18px] shrink-0 items-center rounded-full px-2 text-[11px] font-medium uppercase',
            agent.role === 'admin' ? 'bg-blue-bg text-blue' : 'bg-surface-2 text-text-2',
          )}
        >
          <Tooltip
            title={agent.role === 'admin' ? 'Admin' : 'Agent'}
            label={
              agent.role === 'admin'
                ? 'Admins manage the workspace, team, and all settings.'
                : 'Agents work tickets but cannot change workspace settings.'
            }
          >
            {agent.role}
          </Tooltip>
        </span>
        {agent.status === 'invited' && (
          <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-amber-bg px-2 text-[11px] font-medium text-amber">
            Invited
          </span>
        )}

        <Menu
          align="end"
          triggerLabel={`Manage ${agent.name}`}
          triggerClassName="inline-flex size-8 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text"
          trigger={<IconDots size={18} />}
          items={[
            {
              label: 'Make admin',
              checked: agent.role === 'admin',
              disabled: agent.role === 'admin',
              onSelect: () => void setRole('admin'),
            },
            {
              label: 'Make agent',
              checked: agent.role === 'agent',
              disabled: agent.role === 'agent' || lastAdmin,
              onSelect: () => void setRole('agent'),
            },
            { separator: true },
            {
              label: agent.status === 'invited' ? 'Revoke invite' : 'Remove from team',
              danger: true,
              disabled: lastAdmin,
              onSelect: () => void remove(),
            },
          ]}
        />
      </div>

      {agent.status === 'invited' && agent.inviteToken && <InviteLink token={agent.inviteToken} />}

      <div className="mt-3 border-t border-line pt-3">
        <Tooltip
          title="Handles categories"
          label="New tickets in these categories route to this teammate. Leave empty to cover every category."
        >
          <span className="text-[13px] font-medium">Handles categories</span>
        </Tooltip>
        {categories.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-text-3">Define categories in Settings → Ticket form.</p>
        ) : (
          <>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const active = agent.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    className={cx(
                      'inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors',
                      active
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-line text-text-2 hover:bg-surface-2 hover:text-text',
                    )}
                    onClick={() => void toggleCategory(c)}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12px] text-text-3">Empty = covers every category.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function TeamSettings() {
  const agents = useApp((s) => s.agents);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const [inviteOpen, setInviteOpen] = useState(false);

  const list = useMemo(() => {
    const rank = { active: 0, invited: 1 };
    return Object.values(agents).sort(
      (a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name),
    );
  }, [agents]);

  const activeAdmins = useMemo(
    () => Object.values(agents).filter((a) => a.role === 'admin' && a.status === 'active').length,
    [agents],
  );

  const activeCount = list.filter((a) => a.status === 'active').length;
  const invitedCount = list.length - activeCount;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Team</h2>
        <Button variant="subtle" size="sm" onClick={() => setInviteOpen(true)}>
          <IconPlus size={15} />
          Invite teammate
        </Button>
      </div>
      <p className="mt-2 text-[13px] text-text-3">
        {activeCount} {activeCount === 1 ? 'member' : 'members'}
        {invitedCount > 0 ? ` · ${invitedCount} pending` : ''}. Admins manage settings; agents work
        tickets. Share an invite link to add someone.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {list.map((agent) => (
          <MemberRow
            key={agent.id}
            agent={agent}
            activeAdmins={activeAdmins}
            isSelf={agent.id === currentAgentId}
          />
        ))}
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </section>
  );
}
