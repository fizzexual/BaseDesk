import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';

const FIELD =
  'w-full rounded-md border border-line bg-bg px-2.5 text-[14px] transition-colors focus:border-line-2';

export function NewContactDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const createContact = useApp((s) => s.createContact);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setCompany('');
      setBusy(false);
    }
  }, [open]);

  const canSubmit = name.trim() !== '' && email.includes('@');

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const trimmedCompany = company.trim();
      const id = await createContact({
        name: name.trim(),
        email: email.trim(),
        ...(trimmedCompany !== '' ? { company: trimmedCompany } : {}),
      });
      onClose();
      navigate(`/contacts/${id}`);
      toast('Contact created');
    } catch {
      setBusy(false);
      toast('Could not create the contact');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New contact" width={440}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Name</span>
          <input
            className={cx(FIELD, 'h-9')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Email</span>
          <input
            type="email"
            className={cx(FIELD, 'h-9')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Company (optional)</span>
          <input
            className={cx(FIELD, 'h-9')}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Where they work"
          />
        </label>
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={!canSubmit || busy}>
            Create contact
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
