import { useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

export function Profile() {
  const agent = useApp((s) => s.agents[s.currentAgentId]);
  const updateAgent = useApp((s) => s.updateAgent);
  const [name, setName] = useState(agent?.name ?? '');
  const [signature, setSignature] = useState(agent?.signature ?? '');
  const [saving, setSaving] = useState(false);

  if (!agent) return null;

  const dirty = name.trim() !== agent.name || signature !== agent.signature;
  const valid = name.trim() !== '';

  async function onSave() {
    if (!valid) return;
    setSaving(true);
    try {
      await updateAgent(agent!.id, { name: name.trim(), signature });
      toast('Profile saved');
    } catch {
      toast('Could not save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">Profile</h2>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-line p-4">
        <Avatar name={agent.name} hue={agent.avatarHue} size={40} />
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

      <div className="mt-5 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Display name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Email</span>
          <input type="text" value={agent.email} disabled className={`${FIELD} text-text-3`} />
          <span className="text-[12px] text-text-3">
            Your sign-in address is managed by your workspace admin.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Reply signature</span>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={4}
            placeholder={`— ${agent.name}\nSupport, Acme`}
            className="w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] leading-relaxed outline-none focus:border-line-2 placeholder:text-text-3"
          />
          <span className="text-[12px] text-text-3">
            Appended to your replies when you insert it. Leave blank for none.
          </span>
        </label>
      </div>

      <div className="mt-6">
        <Button variant="primary" size="sm" disabled={!dirty || !valid || saving} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </section>
  );
}
