import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { portalApi } from './api';
import { usePortal } from './store';
import { Button } from '../components/Button';
import { toast } from '../components/Toast';
import { cx } from '../components/util';
import { formatBytes } from '../data/attachments';
import type { Attachment, TicketPriority } from '../data/types';
import { IconChevronLeft, IconPaperclip, IconX } from '../icons';

const FIELD =
  'w-full rounded-md border border-line bg-bg px-3 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';
const MAX_UPLOAD = 10 * 1024 * 1024; // keep in step with the server

// Customers choose an urgency; we never expose "urgent" to avoid inflation.
const URGENCY: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'High' },
];

export function PortalNewTicket() {
  const createTicket = usePortal((s) => s.createTicket);
  const navigate = useNavigate();
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = subject.trim() !== '' && message.trim() !== '';

  async function onFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD) {
          toast(`${file.name} is over 10 MB`);
          continue;
        }
        const att = await portalApi.uploadAttachment(file);
        setPending((prev) => [...prev, att]);
      }
    } catch {
      toast('Could not upload the file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createTicket({
        subject: subject.trim(),
        body: message.trim(),
        priority,
        attachmentIds: pending.map((a) => a.id),
      });
      navigate(`/portal/ticket/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket');
      setBusy(false);
    }
  }

  return (
    <section>
      <Link to="/portal" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-text">
        <IconChevronLeft size={15} />
        All tickets
      </Link>
      <h1 className="mt-3 text-[20px] font-semibold">Open a new ticket</h1>
      <p className="mt-1 text-[13px] text-text-3">Tell us what's going on and we'll get back to you.</p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Subject</span>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A short summary" className={`${FIELD} h-10`} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Urgency</span>
          <div className="flex gap-1.5">
            {URGENCY.map((u) => (
              <button
                key={u.value}
                type="button"
                onClick={() => setPriority(u.value)}
                className={cx(
                  'h-9 flex-1 rounded-md border text-[13px] font-medium transition-colors',
                  priority === u.value ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-text-2 hover:bg-surface-2',
                )}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Message</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={7}
            placeholder="Describe your question or problem in as much detail as you can…"
            className={`${FIELD} resize-y py-2.5 leading-relaxed`}
          />
        </label>

        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <div>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <IconPaperclip size={14} />
              {uploading ? 'Uploading…' : 'Attach a file'}
            </Button>
          </div>
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pending.map((a) => (
                <span key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-surface py-1 pl-2 pr-1 text-[12px]">
                  <IconPaperclip size={12} className="shrink-0 text-text-3" />
                  <span className="max-w-[160px] truncate font-medium">{a.filename}</span>
                  <span className="tabular-nums text-text-3">{formatBytes(a.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.filename}`}
                    onClick={() => setPending((prev) => prev.filter((x) => x.id !== a.id))}
                    className="rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    <IconX size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error !== null && (
          <div className="rounded-md border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">{error}</div>
        )}

        <div>
          <Button variant="primary" size="md" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Submitting…' : 'Submit ticket'}
          </Button>
        </div>
      </form>
    </section>
  );
}
