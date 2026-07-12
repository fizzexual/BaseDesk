import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../data/store';
import type { AiSource, Attachment, Contact, Ticket, TokenUsage } from '../../data/types';
import { formatBytes } from '../../data/attachments';
import { Button } from '../../components/Button';
import { Menu, type MenuItem } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconBook, IconNote, IconPaperclip, IconReply, IconSend, IconSparkle, IconX } from '../../icons';
import { useShortcuts } from '../palette/shortcuts';
import { aiEnabled } from '../ai/engine';
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
  const aiDraft = useApp((s) => s.aiDraft);
  const uploadAttachment = useApp((s) => s.uploadAttachment);
  const [mode, setMode] = useState<Mode>('reply');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftMeta, setDraftMeta] = useState<{ source: AiSource; usage: TokenUsage } | null>(null);
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

  async function draftWithAi() {
    if (drafting) return;
    setDrafting(true);
    try {
      const { body: draft, source, usage } = await aiDraft(ticket.id);
      setBody(draft);
      setDraftMeta({ source, usage });
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
      ? canned.map((c) => ({ label: c.title, onSelect: () => insertAtCursor(c.body) }))
      : [{ label: 'No canned replies yet', disabled: true, onSelect: () => {} }];

  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="mb-2 flex items-center">
        <SegmentedControl<Mode>
          options={[
            { value: 'reply', label: 'Reply', icon: <IconReply size={14} /> },
            { value: 'note', label: 'Note', icon: <IconNote size={14} /> },
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
              <button
                type="button"
                aria-label={`Remove ${a.filename}`}
                onClick={() => setPending((prev) => prev.filter((x) => x.id !== a.id))}
                className="rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-3 hover:text-text"
              >
                <IconX size={12} />
              </button>
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
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <IconPaperclip size={14} />
          {uploading ? 'Uploading…' : 'Attach'}
        </Button>
        {aiEnabled() && (
          <Button variant="ghost" size="sm" onClick={() => void draftWithAi()} disabled={drafting}>
            <IconSparkle size={14} />
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </Button>
        )}
        {draftMeta !== null && (
          <span className="flex items-center gap-1.5 pl-1 text-[12px] text-text-3">
            {draftMeta.source === 'model' ? (
              <>
                <IconBook size={13} className="shrink-0 text-green" />
                <span>From knowledge base</span>
                <span aria-hidden="true">·</span>
                <TokenCost promptTokens={draftMeta.usage.promptTokens} completionTokens={draftMeta.usage.completionTokens} />
              </>
            ) : (
              <span>Rule-based draft</span>
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
