import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { TicketPriority } from '../../data/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { SegmentedControl, type SegmentedOption } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';

const FIELD =
  'w-full rounded-md border border-line bg-bg px-2.5 text-[14px] transition-colors focus:border-line-2';

const PRIORITY_OPTIONS: SegmentedOption<TicketPriority>[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const contacts = useApp((s) => s.contacts);
  const createTicket = useApp((s) => s.createTicket);

  const [subject, setSubject] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const contactList = useMemo(
    () => Object.values(contacts).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );

  useEffect(() => {
    if (open) {
      setSubject('');
      setRequesterId('');
      setPriority('medium');
      setBody('');
      setBusy(false);
    }
  }, [open]);

  const canSubmit = subject.trim() !== '' && requesterId !== '' && body.trim() !== '';

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const id = await createTicket({
        subject: subject.trim(),
        body: body.trim(),
        requesterId,
        priority,
      });
      onClose();
      navigate(`/ticket/${id}`);
    } catch {
      setBusy(false);
      toast('Could not create the ticket');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New ticket" width={520}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Subject</span>
          <input
            className={cx(FIELD, 'h-9')}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Short summary of the request"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Contact</span>
          <select
            className={cx(FIELD, 'h-9')}
            value={requesterId}
            onChange={(e) => setRequesterId(e.target.value)}
          >
            <option value="" disabled>
              Select a contact
            </option>
            {contactList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.email}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Priority</span>
          <div>
            <SegmentedControl options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} />
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Message</span>
          <textarea
            className={cx(FIELD, 'min-h-28 resize-y py-2')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the request"
          />
        </label>
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={!canSubmit || busy}>
            Create ticket
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
