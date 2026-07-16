import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import type { BusinessHours, DayHours } from '../../data/types';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIELD = 'h-9 rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2';

function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const all = intl.supportedValuesOf?.('timeZone');
    return all && all.length > 0 ? all : ['UTC'];
  } catch {
    return ['UTC'];
  }
}

export function BusinessHoursSettings() {
  const businessHours = useApp((s) => s.businessHours);
  const save = useApp((s) => s.saveBusinessHours);
  const [draft, setDraft] = useState<BusinessHours>(businessHours);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(businessHours), [businessHours]);
  const tzList = useMemo(timezones, []);

  const setDay = (i: number, d: DayHours | null) =>
    setDraft((s) => ({ ...s, days: s.days.map((x, j) => (j === i ? d : x)) }));

  async function onSave() {
    setBusy(true);
    try {
      await save(draft);
      toast('Business hours saved');
    } catch {
      toast('Could not save business hours');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[16px] font-semibold">Business hours</h2>
        <p className="mt-1 text-[13px] text-text-2">
          When a customer writes in outside these hours, they get an automatic reply with a live countdown to when you
          reopen — in their local time.
        </p>
      </div>

      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft((s) => ({ ...s, enabled: e.target.checked }))}
          className="size-4 accent-[var(--accent)]"
        />
        <span className="text-[14px] font-medium">Send an outside-hours auto-reply</span>
      </label>

      <div>
        <label htmlFor="bh-tz" className="mb-1.5 block text-[13px] font-medium text-text-2">Time zone</label>
        <select
          id="bh-tz"
          className={cx(FIELD, 'w-full')}
          value={draft.timezone}
          onChange={(e) => setDraft((s) => ({ ...s, timezone: e.target.value }))}
        >
          {tzList.includes(draft.timezone) ? null : <option value={draft.timezone}>{draft.timezone}</option>}
          {tzList.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1.5 text-[13px] font-medium text-text-2">Opening hours</div>
        <div className="flex flex-col gap-1.5">
          {DAY_NAMES.map((name, i) => {
            const d = draft.days[i] ?? null;
            return (
              <div key={name} className="flex items-center gap-2">
                <label className="flex w-32 shrink-0 items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={d !== null}
                    onChange={(e) => setDay(i, e.target.checked ? (d ?? { open: '09:00', close: '17:00' }) : null)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {name}
                </label>
                {d !== null ? (
                  <>
                    <input type="time" className={FIELD} value={d.open} onChange={(e) => setDay(i, { ...d, open: e.target.value })} aria-label={`${name} open`} />
                    <span className="text-text-3">–</span>
                    <input type="time" className={FIELD} value={d.close} onChange={(e) => setDay(i, { ...d, close: e.target.value })} aria-label={`${name} close`} />
                  </>
                ) : (
                  <span className="text-[13px] text-text-3">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="bh-msg" className="mb-1.5 block text-[13px] font-medium text-text-2">Auto-reply message</label>
        <textarea
          id="bh-msg"
          className="min-h-24 w-full resize-y rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] leading-relaxed outline-none focus:border-line-2"
          value={draft.message}
          onChange={(e) => setDraft((s) => ({ ...s, message: e.target.value }))}
        />
        <p className="mt-1.5 text-[12px] text-text-3">
          Supports <code className="rounded bg-surface-3 px-1 font-mono text-[0.9em]">{'{{name}}'}</code> and{' '}
          <code className="rounded bg-surface-3 px-1 font-mono text-[0.9em]">{'{{number}}'}</code>. The live “we reopen
          in…” countdown is added automatically.
        </p>
      </div>

      <div>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void onSave()}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
