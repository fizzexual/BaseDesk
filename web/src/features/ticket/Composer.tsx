import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../data/store';
import type { AiSource, Attachment, CannedReply, Contact, Ticket, TicketPatch, TokenUsage } from '../../data/types';
import { formatBytes } from '../../data/attachments';
import { Button } from '../../components/Button';
import { Menu, type MenuItem } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconBook, IconCheckCircle, IconNote, IconPaperclip, IconReply, IconSend, IconSparkle, IconX } from '../../icons';
import { Link } from 'react-router';
import { useShortcuts } from '../palette/shortcuts';
import { aiEnabled, aiFallbackMessage } from '../ai/engine';
import { TokenCost } from '../ai/TokenCost';

const MAX_UPLOAD = 10 * 1024 * 1024; // keep in step with the server

type Mode = 'reply' | 'note';

const GHOST_TRIGGER =
  'h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text';

function firstName(contact: Contact | undefined): string {
  const first = contact?.name.trim().split(/\s+/)[0];
  return first !== undefined && first !== '' ? first : 'there';
}

export function Composer({ ticket }: { ticket: Ticket }) {
  const contact = useApp((s) => s.contacts[ticket.requesterId]) as Contact | undefined;
  const canned = useApp((s) => s.canned);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const aiDraft = useApp((s) => s.aiDraft);
  const uploadAttachment = useApp((s) => s.uploadAttachment);
  const composerPrefill = useApp((s) => s.composerPrefill);
  const setComposerPrefill = useApp((s) => s.setComposerPrefill);
  const [mode, setMode] = useState<Mode>('reply');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftMeta, setDraftMeta] = useState<{ source: AiSource; usage: TokenUsage; reason?: string } | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function autogrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(autogrow, [body, mode]);

  function focusTextarea() {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // Pull an AI draft (or other prefill) into the composer when requested.
  useEffect(() => {
    if (composerPrefill === null) return;
    setBody(composerPrefill);
    setMode('reply');
    setComposerPrefill(null);
    focusTextarea();
  }, [composerPrefill, setComposerPrefill]);

  function switchMode(next: Mode) {
    setMode(next);
    focusTextarea();
  }

  useShortcuts('ticket', {
    r: () => switchMode('reply'),
    n: () => switchMode('note'),
  });

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? start;
    setBody(body.slice(0, start) + text + body.slice(end));
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const pos = start + text.length;
      node.setSelectionRange(pos, pos);
    });
  }

  // Insert a canned reply's body and, if it's a macro, apply its ticket actions
  // in one shot — skipping any change that's already true so the toast is honest.
  function applyCanned(c: CannedReply) {
    insertAtCursor(c.body);
    const a = c.actions;
    if (a === null || a === undefined) return;
    const patch: TicketPatch = {};
    const summary: string[] = [];
    if (a.status !== undefined && a.status !== ticket.status) {
      patch.status = a.status;
      summary.push(a.status.replace('_', ' '));
    }
    if (a.priority !== undefined && a.priority !== ticket.priority) {
      patch.priority = a.priority;
      summary.push(`${a.priority} priority`);
    }
    if (a.assignToMe === true && ticket.assigneeId !== currentAgentId) {
      patch.assigneeId = currentAgentId;
      summary.push('assigned to you');
    }
    if (a.addTags !== undefined && a.addTags.length > 0) {
      const merged = Array.from(new Set([...ticket.tags, ...a.addTags]));
      if (merged.length !== ticket.tags.length) {
        patch.tags = merged;
        summary.push(a.addTags.map((t) => `#${t}`).join(' '));
      }
    }
    if (summary.length === 0) return;
    useApp
      .getState()
      .patchTicket(ticket.id, patch)
      .then(() => toast(`Macro applied — ${summary.join(', ')}`))
      .catch(() => toast('Could not apply the macro actions'));
  }

  async function draftWithAi() {
    if (drafting) return;
    setDrafting(true);
    try {
      const { body: draft, source, usage, reason } = await aiDraft(ticket.id);
      setBody(draft);
      setDraftMeta({ source, usage, reason });
      // It silently fell back to the rule-based draft — tell the agent why so they can fix it.
      if (source === 'rules') toast(aiFallbackMessage(reason));
      focusTextarea();
    } catch {
      toast('Could not draft a reply');
    } finally {
      setDrafting(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD) {
          toast(`${file.name} is over 10 MB`);
          continue;
        }
        const att = await uploadAttachment(file);
        setPending((prev) => [...prev, att]);
      }
    } catch {
      toast('Could not upload the file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function send() {
    const text = body.trim();
    if (text === '' && pending.length === 0) return;
    const ids = pending.map((a) => a.id);
    const sent = pending;
    setBody('');
    setDraftMeta(null);
    setPending([]);
    focusTextarea();
    useApp
      .getState()
      .sendMessage(ticket.id, mode, text, ids)
      .catch(() => {
        setBody(text);
        setPending(sent);
        toast('Could not send the message');
      });
  }

  const cannedItems: MenuItem[] =
    canned.length > 0
      ? canned.map((c) => ({
          label: c.title,
          // A macro (has actions) gets a spark so agents know it does more than insert text.
          icon: c.actions ? <IconSparkle size={14} className="text-accent" /> : undefined,
          onSelect: () => applyCanned(c),
        }))
      : [{ label: 'No canned replies yet', disabled: true, onSelect: () => {} }];

  // A closed ticket is read-only for everyone — reopen it to write.
  if (ticket.status === 'closed') {
    return (
      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5 text-[13px]">
          <IconCheckCircle size={15} className="shrink-0 text-text-3" />
          <span className="text-text-2">This ticket is closed. Reopen it to reply or add a note.</span>
          <div className="flex-1" />
          <Button
            variant="subtle"
            size="sm"
            onClick={() =>
              useApp.getState().patchTicket(ticket.id, { status: 'open' }).catch(() => toast('Could not reopen the ticket'))
            }
          >
            Reopen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="mb-2 flex items-center">
        <SegmentedControl<Mode>
          options={[
            {
              value: 'reply',
              label: 'Reply',
              icon: (
                <Tooltip title="Reply" label="Sent to the customer as a normal message — they'll see it and be notified.">
                  <IconReply size={14} />
                </Tooltip>
              ),
            },
            {
              value: 'note',
              label: 'Note',
              icon: (
                <Tooltip title="Internal note" label="Only your team can see this — the customer is never notified.">
                  <IconNote size={14} />
                </Tooltip>
              ),
            },
          ]}
          value={mode}
          onChange={switchMode}
        />
      </div>
      <div className={cx(mode === 'note' && 'rounded-md bg-amber-bg')}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={body}
          placeholder={
            mode === 'reply' ? `Reply to ${firstName(contact)}…` : 'Add an internal note…'
          }
          className="max-h-64 min-h-[88px] w-full resize-none bg-transparent p-2 text-[14px] outline-none placeholder:text-text-3"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      {pending.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pending.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 py-1 pl-2 pr-1 text-[12px]">
              <IconPaperclip size={12} className="shrink-0 text-text-3" />
              <span className="max-w-[160px] truncate font-medium">{a.filename}</span>
              <span className="tabular-nums text-text-3">{formatBytes(a.size)}</span>
              <Tooltip label={`Remove ${a.filename}`}>
                <button
                  type="button"
                  aria-label={`Remove ${a.filename}`}
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== a.id))}
                  className="rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-3 hover:text-text"
                >
                  <IconX size={12} />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <div className="mt-2 flex items-center gap-1">
        <Tooltip title="Canned replies" label="Pre-written templates you can insert — some also change the ticket's status, priority, or assignee.">
          <Menu
            triggerLabel="Canned replies"
            triggerClassName={GHOST_TRIGGER}
            trigger={
              <>
                <IconNote size={14} />
                <span>Canned</span>
              </>
            }
            items={cannedItems}
          />
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <IconPaperclip size={14} />
          {uploading ? 'Uploading…' : 'Attach'}
        </Button>
        {aiEnabled() && (
          <Tooltip title="Draft with AI" label="Generates a suggested reply using AI and your knowledge base — review before sending.">
            <Button variant="ghost" size="sm" onClick={() => void draftWithAi()} disabled={drafting}>
              <IconSparkle size={14} />
              {drafting ? 'Drafting…' : 'Draft with AI'}
            </Button>
          </Tooltip>
        )}
        {draftMeta !== null && (
          <span className="flex items-center gap-1.5 pl-1 text-[12px] text-text-3">
            {draftMeta.source === 'model' ? (
              <>
                <IconBook size={13} className="shrink-0 text-green" />
                <span>From knowledge base</span>
                <span aria-hidden="true">·</span>
                <Tooltip title="AI cost" label="Tokens used and the estimated price for this generation, based on your configured AI model.">
                  <TokenCost promptTokens={draftMeta.usage.promptTokens} completionTokens={draftMeta.usage.completionTokens} />
                </Tooltip>
              </>
            ) : (
              <span className="flex items-center gap-1.5">
                <span>Rule-based draft</span>
                <span aria-hidden="true">·</span>
                <Link to="/settings/ai" className="font-medium text-accent hover:underline">
                  {draftMeta.reason === undefined || draftMeta.reason === 'off' ? 'Set up AI' : 'Check AI settings'}
                </Link>
              </span>
            )}
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" disabled={body.trim() === '' && pending.length === 0} onClick={send}>
          <IconSend size={14} />
          {mode === 'reply' ? 'Reply' : 'Add note'}
        </Button>
      </div>
    </div>
  );
}
