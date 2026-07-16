import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../data/store';
import type { Agent, AiSource, Attachment, CannedReply, Contact, MessageEmbed, Ticket, TicketPatch, TokenUsage } from '../../data/types';
import { formatBytes } from '../../data/attachments';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Menu, type MenuItem } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconBook, IconCheckCircle, IconList, IconNote, IconPaperclip, IconReply, IconSend, IconSparkle, IconX } from '../../icons';
import { KbQuoteDialog } from './KbQuoteDialog';
import { CitationEditor } from './CitationEditor';
import { ChoicePromptEditor, isChoicePromptValid, newChoicePrompt } from './ChoicePromptEditor';
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
  const [pendingEmbeds, setPendingEmbeds] = useState<MessageEmbed[]>([]);
  const [uploading, setUploading] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // @mention typeahead: when the caret sits right after "@word", offer teammates.
  const agentsMap = useApp((s) => s.agents);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionMatches = useMemo(() => {
    if (mention === null) return [] as Agent[];
    const q = mention.query.toLowerCase();
    return Object.values(agentsMap)
      .filter((a) => a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [mention, agentsMap]);

  // "/" snippet typeahead: type "/name" to drop in a canned reply (macros included).
  const [snippet, setSnippet] = useState<{ query: string; start: number } | null>(null);
  const [snippetIdx, setSnippetIdx] = useState(0);
  const snippetMatches = useMemo(() => {
    if (snippet === null) return [] as CannedReply[];
    const q = snippet.query.toLowerCase();
    return canned.filter((c) => `${c.title} ${c.body}`.toLowerCase().includes(q)).slice(0, 6);
  }, [snippet, canned]);

  // Draft autosave: keep the reply text per ticket so a refresh or ticket switch
  // never loses it. `skipSave` swallows the write triggered by loading a draft.
  const draftKey = `bd-draft-${ticket.id}`;
  const skipSave = useRef(false);

  /** Track the body + detect an in-progress "@mention" or "/snippet" at the caret. */
  function onBody(value: string, caret: number) {
    setBody(value);
    const before = value.slice(0, caret);
    const at = /(?:^|\s)@(\w*)$/.exec(before);
    const slash = /(?:^|\s)\/(\w*)$/.exec(before);
    if (at) {
      setMention({ query: at[1], start: caret - at[1].length - 1 });
      setMentionIdx(0);
      setSnippet(null);
    } else if (slash) {
      setSnippet({ query: slash[1], start: caret - slash[1].length - 1 });
      setSnippetIdx(0);
      setMention(null);
    } else {
      setMention(null);
      setSnippet(null);
    }
  }

  /** Replace the "@partial" at the caret with the teammate's first name (what the server matches). */
  function insertMention(agent: Agent) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const start = mention?.start ?? caret;
    const first = agent.name.trim().split(/\s+/)[0] ?? agent.name;
    const next = `${body.slice(0, start)}@${first} ${body.slice(caret)}`;
    setBody(next);
    setMention(null);
    const pos = start + first.length + 2; // just past "@First "
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

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

  // Load this ticket's saved draft on mount / ticket change (a pending prefill wins).
  useEffect(() => {
    skipSave.current = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(draftKey);
    } catch {
      /* storage unavailable */
    }
    setBody(composerPrefill === null && saved ? saved : '');
    // Citations are attached to the message, not saved with the draft — start each ticket clean.
    setPendingEmbeds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  // Persist the draft as it changes; clear the key once it's empty (e.g. after send).
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      if (body.trim() === '') localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, body);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

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

  // A macro's ticket actions (status/priority/assignee/tags), applied in one shot —
  // skipping any change that's already true so the toast stays honest.
  function applyCannedActions(c: CannedReply) {
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

  /** From the Canned menu: insert the body at the cursor, then apply any actions. */
  function applyCanned(c: CannedReply) {
    insertAtCursor(c.body);
    applyCannedActions(c);
  }

  /** From "/snippet": replace the typed "/query" with the canned body, then apply actions. */
  function insertSnippet(c: CannedReply) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const start = snippet?.start ?? caret;
    const next = body.slice(0, start) + c.body + body.slice(caret);
    setBody(next);
    setSnippet(null);
    const pos = start + c.body.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
    applyCannedActions(c);
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
    if (text === '' && pending.length === 0 && pendingEmbeds.length === 0) return;
    // A half-built question would be silently dropped server-side — stop and tell the agent.
    if (pendingEmbeds.some((e) => e.type === 'choice_prompt' && !isChoicePromptValid(e))) {
      toast('Add a question and at least two options');
      return;
    }
    const ids = pending.map((a) => a.id);
    const sent = pending;
    const cited = pendingEmbeds;
    setBody('');
    setDraftMeta(null);
    setPending([]);
    setPendingEmbeds([]);
    // Dismiss any open @mention / "/" typeahead so it can't linger over the emptied box.
    setMention(null);
    setSnippet(null);
    focusTextarea();
    useApp
      .getState()
      .sendMessage(ticket.id, mode, text, ids, cited)
      .catch(() => {
        setBody(text);
        setPending(sent);
        setPendingEmbeds(cited);
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
      {mode === 'reply' && canned.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {canned.slice(0, 3).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => applyCanned(c)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[12px] font-medium text-text-2 transition-colors hover:border-line-2 hover:text-text"
            >
              {c.actions ? <IconSparkle size={12} className="text-accent" /> : <IconNote size={12} className="text-text-3" />}
              <span className="max-w-[160px] truncate">{c.title}</span>
            </button>
          ))}
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-text-3">Use “/” to insert a template</span>
        </div>
      )}
      <div className={cx('relative', mode === 'note' && 'rounded-md bg-amber-bg')}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={body}
          placeholder={
            mode === 'reply' ? `Reply to ${firstName(contact)}…` : 'Add an internal note… @ to mention a teammate'
          }
          className="max-h-64 min-h-[88px] w-full resize-none bg-transparent p-2 text-[14px] outline-none placeholder:text-text-3"
          onChange={(e) => onBody(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            if (mention !== null && mentionMatches.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionMatches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionMatches[mentionIdx]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
            }
            if (snippet !== null && snippetMatches.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSnippetIdx((i) => (i + 1) % snippetMatches.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSnippetIdx((i) => (i - 1 + snippetMatches.length) % snippetMatches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertSnippet(snippetMatches[snippetIdx]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setSnippet(null); return; }
            }
            // Enter sends; Shift+Enter (and an in-progress IME composition) still make a newline.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {mention !== null && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-2 z-30 mb-1 w-56 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-2">
            {mentionMatches.map((a, i) => (
              <button
                key={a.id}
                type="button"
                className={cx(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
                  i === mentionIdx ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
                // mousedown (not click) so the textarea keeps focus through the insert
                onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                onMouseEnter={() => setMentionIdx(i)}
              >
                <Avatar name={a.name} hue={a.avatarHue} size={20} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
                <span className="shrink-0 text-[11px] text-text-3">@{a.name.trim().split(/\s+/)[0]}</span>
              </button>
            ))}
          </div>
        )}
        {snippet !== null && snippetMatches.length > 0 && (
          <div className="absolute bottom-full left-2 z-30 mb-1 w-64 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-2">
            {snippetMatches.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={cx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', i === snippetIdx ? 'bg-surface-2' : 'hover:bg-surface-2')}
                // mousedown (not click) so the textarea keeps focus through the insert
                onMouseDown={(e) => { e.preventDefault(); insertSnippet(c); }}
                onMouseEnter={() => setSnippetIdx(i)}
              >
                {c.actions ? (
                  <IconSparkle size={14} className="shrink-0 text-accent" />
                ) : (
                  <IconNote size={14} className="shrink-0 text-text-3" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.title}</span>
              </button>
            ))}
          </div>
        )}
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
      {pendingEmbeds.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {pendingEmbeds.map((e, i) =>
            e.type === 'kb_citation' ? (
              <CitationEditor
                key={`${e.articleId}-${i}`}
                citation={e}
                onChange={(next) => setPendingEmbeds((prev) => prev.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setPendingEmbeds((prev) => prev.filter((_, j) => j !== i))}
              />
            ) : (
              <ChoicePromptEditor
                key={`prompt-${i}`}
                prompt={e}
                onChange={(next) => setPendingEmbeds((prev) => prev.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setPendingEmbeds((prev) => prev.filter((_, j) => j !== i))}
              />
            ),
          )}
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
        <Tooltip title="Cite a help article" label="Attach a passage from a published knowledge-base article to your reply as a sourced citation.">
          <Button variant="ghost" size="sm" onClick={() => setKbOpen(true)}>
            <IconBook size={14} />
            Cite
          </Button>
        </Tooltip>
        <Tooltip title="Ask a question" label="Give the customer buttons or a dropdown to pick from — their choice comes back as a reply.">
          <Button variant="ghost" size="sm" onClick={() => setPendingEmbeds((prev) => [...prev, newChoicePrompt()])}>
            <IconList size={14} />
            Ask
          </Button>
        </Tooltip>
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
        <Tooltip label="Enter to send · Shift+Enter for a new line">
          <Button size="sm" disabled={body.trim() === '' && pending.length === 0 && pendingEmbeds.length === 0} onClick={send}>
            <IconSend size={14} />
            {mode === 'reply' ? 'Reply' : 'Add note'}
          </Button>
        </Tooltip>
      </div>
      {kbOpen && (
        <KbQuoteDialog
          onClose={() => setKbOpen(false)}
          onCite={(citation) => {
            setPendingEmbeds((prev) => [...prev, citation]);
            setKbOpen(false);
          }}
        />
      )}
    </div>
  );
}
