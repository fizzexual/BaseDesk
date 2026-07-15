import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import type { HandoverNote } from '../../data/types';
import { IconClipboard, IconTrash } from '../../icons';

export function HandoverPage() {
  const agents = useApp((s) => s.agents);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const [notes, setNotes] = useState<HandoverNote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo.getHandover().then(
      (n) => !cancelled && setNotes(n),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function post() {
    const body = draft.trim();
    if (body === '' || posting) return;
    setPosting(true);
    try {
      setNotes(await repo.addHandover(body));
      setDraft('');
    } catch {
      toast('Could not post the note');
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    try {
      setNotes(await repo.deleteHandover(id));
    } catch {
      toast('Could not delete the note');
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-col gap-0.5 border-b border-line px-5 py-4">
        <h1 className="text-[15px] font-semibold text-text">Shift handover</h1>
        <span className="text-[13px] text-text-3">Notes for the next shift — what to watch and what's still in flight</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {/* Composer */}
          <div className="rounded-md border border-line p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Leave a note for whoever's on next — escalations to watch, deploys in progress, promises made…"
              className="w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void post();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[12px] text-text-3">Visible to the whole team.</span>
              <Button variant="primary" size="sm" disabled={draft.trim() === '' || posting} onClick={() => void post()}>
                Post note
              </Button>
            </div>
          </div>

          {/* Feed */}
          {failed ? (
            <EmptyState icon={<IconClipboard size={28} />} title="Handover unavailable" hint="Notes could not be loaded. Refresh to try again." />
          ) : notes === null ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <EmptyState
              icon={<IconClipboard size={28} />}
              title="No handover notes yet"
              hint="Post the first note above. It'll be here for the next shift to catch up on."
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {notes.map((n) => (
                <li key={n.id} className="group flex gap-3 rounded-md border border-line p-3">
                  <Avatar name={n.authorName ?? 'Agent'} hue={agents[n.authorId]?.avatarHue ?? 220} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-medium">{n.authorName ?? 'Agent'}</span>
                      <span className="text-[12px] text-text-3">
                        <TimeAgo iso={n.createdAt} />
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-text-2">{n.body}</p>
                  </div>
                  {n.authorId === currentAgentId && (
                    <button
                      type="button"
                      aria-label="Delete note"
                      onClick={() => void remove(n.id)}
                      className="h-fit shrink-0 rounded-sm p-1 text-text-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
                    >
                      <IconTrash size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
