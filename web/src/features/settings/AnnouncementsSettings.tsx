import { useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { useApp } from '../../data/store';
import { cx } from '../../components/util';
import type { Announcement, AnnouncementLevel } from '../../data/types';
import { IconBell, IconTrash } from '../../icons';

const LEVELS: { value: AnnouncementLevel; label: string; color: string }[] = [
  { value: 'info', label: 'Info', color: 'var(--blue)' },
  { value: 'warning', label: 'Warning', color: 'var(--amber)' },
  { value: 'critical', label: 'Critical', color: 'var(--red)' },
];
const levelMeta = (l: AnnouncementLevel) => LEVELS.find((x) => x.value === l) ?? LEVELS[0];

export function AnnouncementsSettings() {
  const announcements = useApp((s) => s.announcements);
  const save = useApp((s) => s.saveAnnouncement);
  const del = useApp((s) => s.deleteAnnouncement);
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<AnnouncementLevel>('info');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (body.trim() === '' || busy) return;
    setBusy(true);
    try {
      await save({ id: '', body: body.trim(), level, active: true, createdAt: '' });
      setBody('');
      setLevel('info');
    } catch {
      toast('Could not post the announcement');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(a: Announcement) {
    try {
      await save({ ...a, active: !a.active });
    } catch {
      toast('Could not update the announcement');
    }
  }
  async function remove(id: string) {
    try {
      await del(id);
      toast('Announcement removed');
    } catch {
      toast('Could not remove the announcement');
    }
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">
        <Tooltip title="Announcements" label="Broadcast a notice to every customer — it appears as a banner across the support portal until you hide or remove it.">
          Announcements
        </Tooltip>
      </h2>
      <p className="mt-0.5 text-[13px] text-text-3">Shown as a banner to customers on the support portal.</p>

      <div className="mt-4 rounded-md border border-line p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="e.g. Scheduled maintenance this Saturday 02:00–04:00 UTC — brief downtime expected."
          className="w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}
            aria-label="Severity"
            className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-line-2"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={body.trim() === '' || busy} onClick={() => void create()}>
            Post announcement
          </Button>
        </div>
      </div>

      {announcements.length === 0 ? (
        <EmptyState icon={IconBell} title="No announcements" hint="Post one to broadcast a notice to customers on the portal." />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {announcements.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-md border border-line p-3">
              <span aria-hidden className="mt-1 inline-block size-2.5 shrink-0 rounded-full" style={{ background: levelMeta(a.level).color }} />
              <p className={cx('min-w-0 flex-1 text-[14px]', !a.active && 'text-text-3 line-through')}>{a.body}</p>
              <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-2">
                <input type="checkbox" checked={a.active} onChange={() => void toggle(a)} />
                Active
              </label>
              <button
                type="button"
                onClick={() => void remove(a.id)}
                aria-label="Remove announcement"
                className="shrink-0 rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
