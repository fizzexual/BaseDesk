import { useState } from 'react';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import type { SideConversation, Ticket } from '../../data/types';
import { IconChevronRight, IconPlus } from '../../icons';

/** Private sub-threads on a ticket — consult a colleague or vendor off the customer conversation. */
export function SideConversations({ ticket }: { ticket: Ticket }) {
  const list = useApp((s) => s.sideConversations[ticket.id]) ?? [];
  const [open, setOpen] = useState<'new' | string | null>(null);

  // Re-read the open conversation from the store so replies appear live.
  const active = typeof open === 'string' ? list.find((c) => c.id === open) ?? null : null;

  return (
    <section className="border-t border-line p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">
          <Tooltip title="Side conversations" label="Private threads to loop in a colleague or vendor — kept separate from the customer's conversation.">
            <span>Side conversations</span>
          </Tooltip>
        </h3>
        <button
          type="button"
          onClick={() => setOpen('new')}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <IconPlus size={13} />
          New
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-[13px] text-text-3">No side conversations.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((c) => {
            const last = c.messages.at(-1);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpen(c.id)}
                  className="group flex w-full items-center gap-2 rounded-md border border-line p-2 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{c.subject}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-text-3">{c.messages.length}</span>
                    </div>
                    {c.participant !== null && <div className="truncate text-[12px] text-text-3">with {c.participant}</div>}
                    {last !== undefined && <div className="mt-0.5 truncate text-[12px] text-text-3">{last.body}</div>}
                  </div>
                  <IconChevronRight size={15} className="shrink-0 text-text-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open === 'new' && <NewSideConversation ticket={ticket} onClose={() => setOpen(null)} />}
      {active !== null && <ViewSideConversation ticket={ticket} convo={active} onClose={() => setOpen(null)} />}
    </section>
  );
}

function NewSideConversation({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const createSideConversation = useApp((s) => s.createSideConversation);
  const [subject, setSubject] = useState('');
  const [participant, setParticipant] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    if (subject.trim() === '' || busy) return;
    setBusy(true);
    try {
      await createSideConversation(ticket.id, subject.trim(), participant.trim() === '' ? null : participant.trim(), body.trim());
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start the side conversation');
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="New side conversation" width={520}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
            placeholder="What's this about?"
            className="h-9 rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">
            Who are you looping in? <span className="font-normal text-text-3">(optional)</span>
          </span>
          <input
            value={participant}
            onChange={(e) => setParticipant(e.target.value)}
            placeholder="e.g. Engineering, or vendor@acme.com"
            className="h-9 rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Start the conversation…"
            className="resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={subject.trim() === '' || busy} onClick={() => void start()}>
            Start conversation
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ViewSideConversation({ ticket, convo, onClose }: { ticket: Ticket; convo: SideConversation; onClose: () => void }) {
  const agents = useApp((s) => s.agents);
  const addSideMessage = useApp((s) => s.addSideMessage);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (reply.trim() === '' || busy) return;
    setBusy(true);
    try {
      await addSideMessage(ticket.id, convo.id, reply.trim());
      setReply('');
    } catch {
      toast('Could not send the message');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={convo.subject} width={520}>
      {convo.participant !== null && <p className="-mt-2 mb-3 text-[13px] text-text-3">with {convo.participant}</p>}
      <div className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto">
        {convo.messages.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-text-3">No messages yet.</p>
        ) : (
          convo.messages.map((m) => (
            <div key={m.id} className="flex gap-2.5">
              <Avatar name={m.authorName ?? 'Agent'} hue={agents[m.authorId]?.avatarHue ?? 220} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{m.authorName ?? 'Agent'}</span>
                  <span className="text-[12px] text-text-3">
                    <TimeAgo iso={m.at} />
                  </span>
                </div>
                <p className="whitespace-pre-line text-[13px] text-text-2">{m.body}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="Reply…"
          className="w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button variant="primary" size="sm" disabled={reply.trim() === '' || busy} onClick={() => void send()}>
            Send
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
