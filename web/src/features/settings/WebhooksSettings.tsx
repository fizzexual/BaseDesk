import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { repo } from '../../data';
import { WEBHOOK_EVENTS, type Webhook, type WebhookDelivery, type WebhookEvent } from '../../data/types';
import { IconChannels, IconTrash } from '../../icons';

const errText = (err: unknown, fallback: string): string => (err instanceof Error && err.message !== '' ? err.message : fallback);

function deliveryLine(d: WebhookDelivery): { text: string; tone: 'ok' | 'bad' | 'wait' } {
  const when = new Date(d.createdAt).toLocaleString();
  if (d.status === 'delivered') return { text: `${d.event} · delivered (HTTP ${d.lastStatus}) · ${when}`, tone: 'ok' };
  if (d.status === 'failed') return { text: `${d.event} · failed: ${d.lastError ?? 'unknown error'} · ${when}`, tone: 'bad' };
  const retry = d.attempts > 0 ? ` · retry ${d.attempts + 1} at ${new Date(d.nextAttemptAt).toLocaleTimeString()} (${d.lastError ?? ''})` : '';
  return { text: `${d.event} · waiting${retry} · ${when}`, tone: 'wait' };
}

const TONE = { ok: 'text-green', bad: 'text-red', wait: 'text-text-3' } as const;

/** The secret is shown once, right after it is made. */
function SecretBox({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-amber/40 bg-surface-2 p-3 text-[13px]">
      <p className="font-medium">Signing secret — copy it now, it is not shown again.</p>
      <code className="mt-1.5 block select-all break-all rounded-sm bg-surface px-2 py-1.5 font-mono text-[12px]">{secret}</code>
      <p className="mt-1.5 text-text-3">
        Each request carries <code>X-BaseDesk-Signature: sha256=&lt;HMAC-SHA256 of the raw body with this secret&gt;</code>. Check it before trusting the body.
      </p>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="subtle" onClick={onClose}>
          I saved it
        </Button>
      </div>
    </div>
  );
}

function EventPicker({ value, onChange, idPrefix }: { value: WebhookEvent[]; onChange: (v: WebhookEvent[]) => void; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-1">
      {WEBHOOK_EVENTS.map((e) => (
        <label key={e.value} htmlFor={`${idPrefix}-${e.value}`} className="flex items-center gap-2 text-[13px] text-text-2">
          <input
            id={`${idPrefix}-${e.value}`}
            type="checkbox"
            checked={value.includes(e.value)}
            onChange={() => onChange(value.includes(e.value) ? value.filter((x) => x !== e.value) : [...value, e.value])}
          />
          {e.label} <code className="text-[11px] text-text-3">{e.value}</code>
        </label>
      ))}
    </div>
  );
}

function WebhookRow({ hook, onChanged, onRemoved }: { hook: Webhook; onChanged: (w: Webhook) => void; onRemoved: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  async function loadDeliveries() {
    try {
      setDeliveries(await repo.listWebhookDeliveries(hook.id));
    } catch (err) {
      toast(errText(err, 'Could not load deliveries'));
    }
  }
  async function patch(p: Parameters<typeof repo.updateWebhook>[1]) {
    try {
      const res = await repo.updateWebhook(hook.id, p);
      onChanged(res.webhook);
      if (res.secret) setSecret(res.secret);
    } catch (err) {
      toast(errText(err, 'Could not update the webhook'));
    }
  }
  async function test() {
    setTesting(true);
    try {
      const d = await repo.testWebhook(hook.id);
      onChanged({ ...hook, lastDelivery: d, failed: hook.failed + (d.status === 'failed' ? 1 : 0) });
      if (open) await loadDeliveries();
      if (d.status !== 'delivered') toast(`Test failed: ${d.lastError ?? 'no answer'}`);
    } catch (err) {
      toast(errText(err, 'Could not send the test'));
    } finally {
      setTesting(false);
    }
  }
  async function retry(id: string) {
    try {
      await repo.retryWebhookDelivery(id);
      await loadDeliveries();
    } catch (err) {
      toast(errText(err, 'Could not retry'));
    }
  }
  async function remove() {
    if (!window.confirm(`Remove the webhook to ${hook.url}? Pending deliveries are dropped.`)) return;
    try {
      await repo.deleteWebhook(hook.id);
      onRemoved(hook.id);
    } catch (err) {
      toast(errText(err, 'Could not remove the webhook'));
    }
  }

  const last = hook.lastDelivery ? deliveryLine(hook.lastDelivery) : null;
  return (
    <div className="rounded-md border border-line p-3" data-testid="webhook-row">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cx('truncate font-mono text-[13px]', !hook.enabled && 'text-text-3 line-through')} title={hook.url}>
            {hook.url}
          </p>
          <p className="mt-0.5 text-[12px] text-text-3">{hook.events.join(' · ')}</p>
          {last && <p className={cx('mt-1 truncate text-[12px]', TONE[last.tone])}>Last: {last.text}</p>}
          {hook.failed > 0 && <p className="mt-0.5 text-[12px] text-red">{hook.failed} delivery(ies) gave up after every retry.</p>}
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-2">
          <input type="checkbox" checked={hook.enabled} onChange={() => void patch({ enabled: !hook.enabled })} />
          On
        </label>
        <button
          type="button"
          onClick={() => void remove()}
          aria-label="Remove webhook"
          className="shrink-0 rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <IconTrash size={14} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="subtle" disabled={testing} onClick={() => void test()}>
          {testing ? 'Sending…' : 'Send test'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) void loadDeliveries();
          }}
        >
          {open ? 'Hide deliveries' : 'Deliveries'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void patch({ rotateSecret: true })}>
          New secret
        </Button>
      </div>
      {secret && <SecretBox secret={secret} onClose={() => setSecret(null)} />}
      {open && (
        <div className="mt-3 border-t border-line pt-2">
          <EventPicker idPrefix={hook.id} value={hook.events} onChange={(events) => (events.length > 0 ? void patch({ events }) : toast('Keep at least one event'))} />
          <ul className="mt-3 flex flex-col gap-1">
            {deliveries === null && <li className="text-[12px] text-text-3">Loading…</li>}
            {deliveries?.length === 0 && <li className="text-[12px] text-text-3">Nothing sent yet.</li>}
            {deliveries?.map((d) => {
              const line = deliveryLine(d);
              return (
                <li key={d.id} className="flex items-center gap-2 text-[12px]">
                  <span className={cx('min-w-0 flex-1 truncate', TONE[line.tone])} title={line.text}>
                    {line.text}
                  </span>
                  {d.status === 'failed' && d.event !== 'ping' && (
                    <button type="button" className="shrink-0 text-blue hover:underline" onClick={() => void retry(d.id)}>
                      Retry
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WebhooksSettings() {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['ticket.created', 'message.created']);
  const [busy, setBusy] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  useEffect(() => {
    repo.listWebhooks().then(setHooks, (err: unknown) => setLoadError(errText(err, 'Could not load webhooks')));
  }, []);

  async function create() {
    if (url.trim() === '' || events.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await repo.createWebhook(url.trim(), events);
      setHooks((h) => [...(h ?? []), res.webhook]);
      setNewSecret(res.secret ?? null);
      setUrl('');
    } catch (err) {
      toast(errText(err, 'Could not add the webhook'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">
        <Tooltip title="Webhooks" label="BaseDesk sends a signed JSON POST to your URL when tickets and replies change — wire it to Slack, a CRM, or your own code.">
          Webhooks
        </Tooltip>
      </h2>
      <p className="mt-0.5 text-[13px] text-text-3">
        A signed JSON POST to your URL when something happens. Failed sends are retried for about 7 hours.
      </p>

      <div className="mt-4 rounded-md border border-line p-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/basedesk-hook"
          aria-label="Webhook URL"
          className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
        />
        <div className="mt-2">
          <EventPicker idPrefix="new" value={events} onChange={setEvents} />
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={url.trim() === '' || events.length === 0 || busy} onClick={() => void create()}>
            Add webhook
          </Button>
        </div>
        {newSecret && <SecretBox secret={newSecret} onClose={() => setNewSecret(null)} />}
      </div>

      {loadError !== null ? (
        <p className="mt-4 text-[13px] text-red">{loadError}</p>
      ) : hooks === null ? (
        <p className="mt-4 text-[13px] text-text-3">Loading…</p>
      ) : hooks.length === 0 ? (
        <EmptyState icon={IconChannels} title="No webhooks" hint="Add a URL above to get ticket and reply events pushed to it." />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {hooks.map((h) => (
            <WebhookRow
              key={h.id}
              hook={h}
              onChanged={(w) => setHooks((list) => (list ?? []).map((x) => (x.id === w.id ? w : x)))}
              onRemoved={(id) => setHooks((list) => (list ?? []).filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
