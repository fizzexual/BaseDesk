import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { portalApi } from './api';
import { usePortal } from './store';
import { Button } from '../components/Button';
import { Skeleton } from './Skeleton';
import { toast } from '../components/Toast';
import { cx } from '../components/util';
import { formatBytes } from '../data/attachments';
import type { Attachment, IntakeAnswer, IntakeForm, IntakeNode, IntakeOption, KbArticle, TicketPriority } from '../data/types';
import { IconBook, IconCheck, IconChevronLeft, IconChevronRight, IconPaperclip, IconX } from '../icons';

const FIELD =
  'w-full rounded-md border border-line bg-bg px-3 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';
const MAX_UPLOAD = 10 * 1024 * 1024; // keep in step with the server
// A malformed or cyclic intake tree could otherwise trap the customer forever.
const MAX_WIZARD_STEPS = 20;

// Customers choose an urgency; we never expose "urgent" to avoid inflation.
const URGENCY: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'High' },
];

/** One answered intake question. Keeps the full option (not just the label) so
 * category/tags/back-navigation can be re-derived any time from `steps` alone. */
interface WizardStep {
  nodeId: string;
  prompt: string;
  option: IntakeOption;
}

export function PortalNewTicket() {
  const createTicket = usePortal((s) => s.createTicket);
  const navigate = useNavigate();

  // Intake wizard: fetched form + where the customer currently is in the tree.
  const [form, setForm] = useState<IntakeForm | null>(null);
  const [formLoaded, setFormLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [steps, setSteps] = useState<WizardStep[]>([]);

  // Ticket fields (unchanged from before the wizard existed).
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Deflection: after the wizard, suggest help articles so the customer can
  // self-serve instead of opening a ticket. null = not fetched yet.
  const [suggestions, setSuggestions] = useState<KbArticle[] | null>(null);
  const [needHelp, setNeedHelp] = useState(false); // customer clicked "I still need help"
  const [resolved, setResolved] = useState(false); // customer clicked "That solved it"

  useEffect(() => {
    let cancelled = false;
    portalApi
      .intakeForm()
      .then((f) => {
        if (cancelled) return;
        setForm(f);
        // Only enter the wizard if the tree is actually usable (enabled, rooted, root resolves).
        setCurrentId(f.enabled && f.rootId !== null && f.nodes[f.rootId] ? f.rootId : null);
      })
      .catch(() => {
        // Fail open — if the form can't be loaded, skip straight to the ticket fields.
        if (!cancelled) setCurrentId(null);
      })
      .finally(() => {
        if (!cancelled) setFormLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeNode: IntakeNode | null =
    form !== null && currentId !== null ? (form.nodes[currentId] ?? null) : null;
  // A node with no options is a dead end — treat it as "done" rather than stranding the customer.
  const showWizard = activeNode !== null && activeNode.options.length > 0;

  // Later picks override the category; tags accumulate across every step, deduped.
  const category = useMemo<string | null>(
    () => steps.reduce<string | null>((acc, s) => (s.option.category !== null ? s.option.category : acc), null),
    [steps],
  );
  const tags = useMemo(() => Array.from(new Set(steps.flatMap((s) => s.option.tags))), [steps]);
  const answers: IntakeAnswer[] = useMemo(
    () => steps.map((s) => ({ prompt: s.prompt, label: s.option.label })),
    [steps],
  );

  // The wizard is "finished" once the customer walked at least one step and there's
  // no further question to show. That's when we offer help articles.
  const wizardFinished = !showWizard && steps.length > 0;

  useEffect(() => {
    if (!wizardFinished || suggestions !== null) return;
    const q = [category ?? '', ...answers.flatMap((a) => [a.prompt, a.label])].join(' ').trim();
    if (q === '') {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    portalApi
      .kbSuggest(q)
      .then((list) => { if (!cancelled) setSuggestions(list); })
      .catch(() => { if (!cancelled) setSuggestions([]); });
    return () => { cancelled = true; };
  }, [wizardFinished, suggestions, category, answers]);

  function choose(node: IntakeNode, option: IntakeOption) {
    const nextSteps = [...steps, { nodeId: node.id, prompt: node.prompt, option }];
    setSteps(nextSteps);
    const nodes = form?.nodes ?? {};
    const finished = option.next === null || !(option.next in nodes) || nextSteps.length >= MAX_WIZARD_STEPS;
    setCurrentId(finished ? null : option.next);
  }

  // Re-entering the wizard invalidates any help suggestions we fetched.
  function clearDeflection() {
    setSuggestions(null);
    setNeedHelp(false);
    setResolved(false);
  }

  function goBack() {
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    setSteps(steps.slice(0, -1));
    setCurrentId(last.nodeId);
    clearDeflection();
  }

  function resetWizard() {
    setSteps([]);
    setCurrentId(form?.rootId ?? null);
    clearDeflection();
  }

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
        category,
        tags,
        answers,
      });
      navigate(`/portal/ticket/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px]">
      {/* Context sidebar — keeps New ticket consistent with the rest of the portal */}
      <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-r border-line lg:block">
        <div className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-[13px] font-semibold">What happens next</h2>
            <ol className="mt-3 flex flex-col gap-3">
              <li className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-2">1</span>
                <span className="text-[12px] leading-relaxed text-text-3">Tell us what’s going on — the more detail, the faster we can help.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-2">2</span>
                <span className="text-[12px] leading-relaxed text-text-3">We route it to the right person on the team automatically.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-2">3</span>
                <span className="text-[12px] leading-relaxed text-text-3">You’ll get an email the moment we reply — and can follow along here.</span>
              </li>
            </ol>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="text-[12px] font-medium">Typical response</p>
            <p className="mt-0.5 text-[12px] text-text-3">A few hours during business days.</p>
          </div>
          <Link to="/portal/help" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline">
            <IconBook size={14} />
            Browse the help center
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <section className="mx-auto w-full max-w-[680px] px-5 py-8 sm:px-8">
          <Link to="/portal" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-text">
            <IconChevronLeft size={15} />
            All tickets
          </Link>
          <h1 className="mt-3 text-[22px] font-semibold tracking-tight">Open a new ticket</h1>
          <p className="mt-1 text-[13px] text-text-3">
            {showWizard
              ? 'A couple of quick questions will help us get you to the right place.'
              : "Tell us what's going on and we'll get back to you."}
          </p>

          {!formLoaded ? (
            <div className="mt-6 flex flex-col gap-2.5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-6">
              {steps.length > 0 && (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {steps.map((s, i) => (
                      <span key={`${s.nodeId}-${i}`} className="flex items-center gap-1.5">
                        {i > 0 && <IconChevronRight size={12} className="shrink-0 text-text-3" />}
                        <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-2">
                          {s.option.label}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={goBack}>
                      Back
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={resetWizard}>
                      Start over
                    </Button>
                  </div>
                </div>
              )}

              {showWizard && activeNode !== null ? (
                <div>
                  <h2 className="text-[16px] font-semibold">{activeNode.prompt}</h2>
                  <div className="mt-3.5 flex flex-col gap-2">
                    {activeNode.options.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => choose(activeNode, opt)}
                        className="group flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left text-[14px] font-medium transition-all hover:border-accent/60 hover:bg-surface-2"
                      >
                        {opt.label}
                        <IconChevronRight
                          size={16}
                          className="shrink-0 text-text-3 transition-all group-hover:translate-x-0.5 group-hover:text-accent"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : resolved ? (
                <div className="rounded-lg border border-line bg-surface p-6 text-center">
                  <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-green-bg text-green">
                    <IconCheck size={22} />
                  </span>
                  <h2 className="mt-3 text-[16px] font-semibold">Glad that helped!</h2>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-text-3">
                    No need to open a ticket. If something else comes up, you can always start a new one.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button variant="primary" size="md" onClick={() => navigate('/portal')}>
                      Back to my tickets
                    </Button>
                    <Button variant="ghost" size="md" onClick={() => { setResolved(false); setNeedHelp(true); }}>
                      Open a ticket anyway
                    </Button>
                  </div>
                </div>
              ) : wizardFinished && suggestions === null ? (
                <div className="flex flex-col gap-2.5">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : wizardFinished && suggestions !== null && suggestions.length > 0 && !needHelp ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-bg text-blue">
                      <IconBook size={15} />
                    </span>
                    <h2 className="text-[15px] font-medium">These might answer your question</h2>
                  </div>
                  <p className="mt-1 text-[13px] text-text-3">
                    Based on your answers — a quick read here may save you the wait.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {suggestions.map((a) => (
                      <details
                        key={a.id}
                        open
                        className="group rounded-lg border border-line bg-surface px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
                      >
                        <summary className="flex cursor-pointer items-center justify-between gap-3 text-[14px] font-medium">
                          {a.title}
                          <IconChevronRight size={16} className="shrink-0 text-text-3 transition-transform group-open:rotate-90" />
                        </summary>
                        <div className="mt-2.5 whitespace-pre-wrap border-t border-line pt-2.5 text-[13px] leading-relaxed text-text-2">
                          {a.body}
                        </div>
                      </details>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="md" onClick={() => setResolved(true)}>
                      That solved it — I&apos;m all set
                    </Button>
                    <Button variant="ghost" size="md" onClick={() => setNeedHelp(true)}>
                      I still need help
                    </Button>
                  </div>
                </div>
              ) : (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
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
                            <span key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-bg py-1 pl-2 pr-1 text-[12px]">
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
                  </div>

                  {error !== null && (
                    <div className="rounded-md border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">{error}</div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12px] text-text-3">We usually reply within a few hours during business days.</p>
                    <Button variant="primary" size="md" disabled={!valid || busy} onClick={() => void submit()}>
                      {busy ? 'Submitting…' : 'Submit ticket'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
