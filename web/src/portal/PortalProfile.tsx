import { useState } from 'react';
import { portalApi } from './api';
import { usePortal } from './store';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-bg px-3 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

export function PortalProfile() {
  const contact = usePortal((s) => s.contact);
  const updateProfile = usePortal((s) => s.updateProfile);

  const [name, setName] = useState(contact?.name ?? '');
  const [company, setCompany] = useState(contact?.company ?? '');
  const [location, setLocation] = useState(contact?.location ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  if (!contact) return null;

  const profileDirty =
    name.trim() !== contact.name ||
    (company.trim() || null) !== (contact.company ?? null) ||
    (location.trim() || null) !== (contact.location ?? null);

  async function saveProfile() {
    if (name.trim() === '' || savingProfile) return;
    setSavingProfile(true);
    try {
      await updateProfile({ name: name.trim(), company: company.trim() || null, location: location.trim() || null });
      toast('Profile saved');
    } catch {
      toast('Could not save profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (next.length < 8 || changingPw) return;
    setChangingPw(true);
    setPwError(null);
    try {
      await portalApi.changePassword({ current, next });
      setCurrent('');
      setNext('');
      toast('Password changed');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setChangingPw(false);
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-[20px] font-semibold">Your profile</h1>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-surface p-4">
          <Avatar name={contact.name} hue={contact.avatarHue} size={40} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{contact.name}</div>
            <div className="truncate text-[13px] text-text-3">{contact.email}</div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Email</span>
            <input type="text" value={contact.email} disabled className={`${FIELD} text-text-3`} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Company</span>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Location</span>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" className={FIELD} />
          </label>
          <div>
            <Button variant="primary" size="sm" disabled={!profileDirty || name.trim() === '' || savingProfile} onClick={() => void saveProfile()}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t border-line pt-8">
        <h2 className="text-[16px] font-semibold">Change password</h2>
        <div className="mt-4 flex max-w-sm flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Current password</span>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} autoComplete="current-password" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">New password</span>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" className={FIELD} autoComplete="new-password" />
          </label>
          {pwError !== null && (
            <div className="rounded-md border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">{pwError}</div>
          )}
          <div>
            <Button variant="subtle" size="sm" disabled={current === '' || next.length < 8 || changingPw} onClick={() => void changePassword()}>
              {changingPw ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
