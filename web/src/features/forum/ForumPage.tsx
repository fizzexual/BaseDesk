import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { repo } from '../../data';
import { FORUM_CATEGORIES, type ForumCategory, type ForumList, type ForumTopic, type ForumTopicDetail } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconCheckCircle, IconChevronLeft, IconCommunity, IconLock, IconMegaphone, IconPlus, IconTeam, IconTrash } from '../../icons';

const CATEGORY_LABEL: Record<ForumCategory, string> = {
  general: 'General',
  'how-to': 'How-to',
  tips: 'Tips & tricks',
  bugs: 'Bugs',
  'feature-requests': 'Feature requests',
};

function hueFor(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function CategoryPill({ category }: { category: ForumCategory }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-text-2">
      {CATEGORY_LABEL[category]}
    </span>
  );
}

function AuthorBadge({ isAgent }: { isAgent: boolean }) {
  if (!isAgent) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-bg px-1.5 py-0.5 text-[11px] font-medium text-accent">
      <IconTeam size={11} /> Team
    </span>
  );
}

const FIELD = 'w-full rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

// --- Topic list ---

function NewTopic({ onCreated }: { onCreated: (t: ForumTopicDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<ForumCategory>('general');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (title.trim() === '') return;
    setBusy(true);
    try {
      const t = await repo.createForumTopic({ title: title.trim(), body: body.trim(), category });
      onCreated(t);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post the topic');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <IconPlus size={15} /> New topic
      </Button>
    );
  }
  return (
    <div className="w-full rounded-lg border border-line bg-surface p-4">
      <div className="text-[14px] font-semibold">Start a topic</div>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={cx(FIELD, 'mt-3')} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share the details…" rows={4} className={cx(FIELD, 'mt-2 resize-y')} />
      <div className="mt-2 flex items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value as ForumCategory)} className={cx(FIELD, 'h-9 w-auto')}>
          {FORUM_CATEGORIES.map((cvalue) => (
            <option key={cvalue} value={cvalue}>{CATEGORY_LABEL[cvalue]}</option>
          ))}
        </select>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || title.trim() === ''}>
          {busy ? 'Posting…' : 'Post topic'}
        </Button>
      </div>
    </div>
  );
}

function TopicRow({ topic, onOpen }: { topic: ForumTopic; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(topic.id)}
      className="flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <Avatar name={topic.authorName} hue={hueFor(topic.authorName)} size={34} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {topic.pinned && <IconMegaphone size={14} className="shrink-0 text-accent" />}
          {topic.locked && <IconLock size={13} className="shrink-0 text-text-3" />}
          <span className="truncate text-[14px] font-medium">{topic.title}</span>
          {topic.solved && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-bg px-1.5 py-0.5 text-[11px] font-medium text-green">
              <IconCheckCircle size={11} /> Solved
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-3">
          <CategoryPill category={topic.category} />
          <span>{topic.authorName}</span>
          <span>·</span>
          <TimeAgo iso={topic.lastActivityAt} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 text-[12px] text-text-3">
        <span className="tabular-nums">{topic.replyCount} {topic.replyCount === 1 ? 'reply' : 'replies'}</span>
        <span className="tabular-nums">{topic.views} views</span>
      </div>
    </button>
  );
}

function TopicList() {
  const navigate = useNavigate();
  const [list, setList] = useState<ForumList | null>(null);
  const [category, setCategory] = useState<ForumCategory | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((cat: ForumCategory | 'all') => {
    repo.getForumTopics(cat === 'all' ? undefined : cat)
      .then(setList)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the community'));
  }, []);

  useEffect(() => load(category), [category, load]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-col p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold">Community</h1>
          <p className="mt-0.5 text-[13px] text-text-3">Questions, tips, and feature requests from your customers.</p>
        </div>
        <NewTopic onCreated={(t) => navigate(`/community/${t.id}`)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(['all', ...FORUM_CATEGORIES] as const).map((cvalue) => (
          <button
            key={cvalue}
            type="button"
            onClick={() => setCategory(cvalue)}
            className={cx(
              'h-7 rounded-full px-2.5 text-[13px] font-medium transition-colors',
              category === cvalue ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-text-2 hover:bg-surface-3',
            )}
          >
            {cvalue === 'all' ? 'All' : CATEGORY_LABEL[cvalue]}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface">
        {error !== null ? (
          <EmptyState icon={IconCommunity} title="Couldn't load the community" hint={error} />
        ) : list === null ? (
          <div className="p-6 text-[13px] text-text-3">Loading…</div>
        ) : list.topics.length === 0 ? (
          <EmptyState icon={IconCommunity} title="No topics yet" hint="Start the first conversation." />
        ) : (
          list.topics.map((t) => <TopicRow key={t.id} topic={t} onOpen={(id) => navigate(`/community/${id}`)} />)
        )}
      </div>
    </div>
  );
}

// --- Topic detail ---

function TopicDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState<ForumTopicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    repo.getForumTopic(id)
      .then(setTopic)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the topic'));
  }, [id]);

  const run = async (p: Promise<ForumTopicDetail>, fail: string) => {
    setBusy(true);
    try {
      setTopic(await p);
    } catch (err) {
      toast(err instanceof Error ? err.message : fail);
    } finally {
      setBusy(false);
    }
  };

  async function postReply() {
    if (reply.trim() === '' || topic === null) return;
    setBusy(true);
    try {
      setTopic(await repo.replyForumTopic(topic.id, reply.trim()));
      setReply('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not post the reply');
    } finally {
      setBusy(false);
    }
  }

  async function removeTopic() {
    if (topic === null) return;
    try {
      await repo.deleteForumTopic(topic.id);
      navigate('/community');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the topic');
    }
  }

  if (error !== null) {
    return (
      <div className="mx-auto w-full max-w-[820px] p-6">
        <button type="button" onClick={() => navigate('/community')} className="mb-4 inline-flex items-center gap-1 text-[13px] text-text-2 hover:text-text">
          <IconChevronLeft size={15} /> Community
        </button>
        <EmptyState icon={IconCommunity} title="Topic unavailable" hint={error} />
      </div>
    );
  }
  if (topic === null) return <div className="mx-auto w-full max-w-[820px] p-6 text-[13px] text-text-3">Loading…</div>;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-col p-6">
      <button type="button" onClick={() => navigate('/community')} className="mb-4 inline-flex items-center gap-1 self-start text-[13px] text-text-2 hover:text-text">
        <IconChevronLeft size={15} /> Community
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Topic header */}
        <div className="flex items-start gap-3">
          <Avatar name={topic.authorName} hue={hueFor(topic.authorName)} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {topic.pinned && <IconMegaphone size={15} className="text-accent" />}
              {topic.locked && <IconLock size={14} className="text-text-3" />}
              <h1 className="text-[17px] font-semibold">{topic.title}</h1>
              {topic.solved && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-bg px-2 py-0.5 text-[12px] font-medium text-green">
                  <IconCheckCircle size={12} /> Solved
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-3">
              <CategoryPill category={topic.category} />
              <span className="inline-flex items-center gap-1.5">{topic.authorName} <AuthorBadge isAgent={topic.authorIsAgent} /></span>
              <span>·</span>
              <TimeAgo iso={topic.createdAt} />
              <span>·</span>
              <span>{topic.views} views</span>
            </div>
          </div>
        </div>
        {topic.body.trim() !== '' && <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-text">{topic.body}</p>}

        {/* Moderation toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-line py-2 text-[13px]">
          <span className="text-text-3">Moderate:</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(repo.moderateForumTopic(topic.id, { pinned: !topic.pinned }), 'Could not update')}>
            {topic.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(repo.moderateForumTopic(topic.id, { locked: !topic.locked }), 'Could not update')}>
            {topic.locked ? 'Unlock' : 'Lock'}
          </Button>
          <select
            value={topic.category}
            disabled={busy}
            onChange={(e) => void run(repo.moderateForumTopic(topic.id, { category: e.target.value as ForumCategory }), 'Could not update')}
            className="h-8 rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus:border-line-2"
          >
            {FORUM_CATEGORIES.map((cvalue) => <option key={cvalue} value={cvalue}>{CATEGORY_LABEL[cvalue]}</option>)}
          </select>
          <div className="flex-1" />
          <button type="button" onClick={() => void removeTopic()} className="inline-flex items-center gap-1 text-[13px] text-red hover:underline">
            <IconTrash size={14} /> Delete topic
          </button>
        </div>

        {/* Replies */}
        <div className="mt-4 flex flex-col gap-3">
          {topic.replies.map((r) => (
            <div key={r.id} className={cx('rounded-lg border p-3', r.accepted ? 'border-green/40 bg-green-bg' : 'border-line bg-surface')}>
              <div className="flex items-center gap-2">
                <Avatar name={r.authorName} hue={hueFor(r.authorName)} size={24} />
                <span className="text-[13px] font-medium">{r.authorName}</span>
                <AuthorBadge isAgent={r.authorIsAgent} />
                {r.accepted && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green px-1.5 py-0.5 text-[11px] font-medium text-white">
                    <IconCheckCircle size={11} /> Accepted answer
                  </span>
                )}
                <span className="text-[12px] text-text-3">·</span>
                <TimeAgo iso={r.createdAt} />
                <div className="flex-1" />
                {!r.accepted && (
                  <button type="button" disabled={busy} onClick={() => void run(repo.acceptForumReply(topic.id, r.id), 'Could not accept')} className="text-[12px] font-medium text-green hover:underline disabled:opacity-50">
                    Accept
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => void run(repo.deleteForumReply(r.id).then(() => repo.getForumTopic(topic.id)), 'Could not delete')} className="text-text-3 hover:text-red">
                  <IconTrash size={13} />
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-text">{r.body}</p>
            </div>
          ))}
          {topic.replies.length === 0 && <p className="text-[13px] text-text-3">No replies yet.</p>}
        </div>

        {/* Reply composer */}
        {topic.locked ? (
          <p className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-text-3">This topic is locked — no new replies.</p>
        ) : (
          <div className="mt-4">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" rows={3} className={cx(FIELD, 'resize-y')} />
            <div className="mt-2 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => void postReply()} disabled={busy || reply.trim() === ''}>
                {busy ? 'Posting…' : 'Reply'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ForumPage() {
  const { id } = useParams<{ id?: string }>();
  return id !== undefined ? <TopicDetail id={id} /> : <TopicList />;
}
