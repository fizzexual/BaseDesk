import { useState, type ComponentType } from 'react';
import { useApp } from '../../data/store';
import type { ChannelConn, ChannelTestResult, ChannelType } from '../../data/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import {
  IconChannels,
  IconCommand,
  IconContacts,
  IconInbox,
  IconReply,
  IconSend,
} from '../../icons';

type Glyph = ComponentType<{ size?: number; className?: string }>;

export interface ChannelOutbound {
  /** Whether BaseDesk can deliver agent replies outbound on this channel. */
  supported: boolean;
  urlLabel: string;
  urlPlaceholder: string;
  /** Where to find the URL, or (when unsupported) how replies are delivered instead. */
  help: string;
  /** Whether the optional Bearer-token field applies (relay endpoints). */
  secret: boolean;
}

export interface ChannelTypeMeta {
  label: string;
  glyph: Glyph;
  description: string;
  /** Honest one-line status shown on the "Add a channel" card. */
  status: string;
  addressPlaceholder: string;
  outbound: ChannelOutbound;
}

/** A relayed channel: BaseDesk POSTs a generic JSON reply envelope to a forwarder. */
const relay = (path: string, forwardTo: string): ChannelOutbound => ({
  supported: true,
  urlLabel: 'Relay endpoint URL',
  urlPlaceholder: `https://your-relay.example.com/${path}`,
  help: `We POST each reply as JSON; a small relay forwards it ${forwardTo}.`,
  secret: true,
});

/**
 * Canonical channel-type metadata. It lives in this leaf module so that both
 * ChannelsPage and the per-ticket source badge (TicketPage) can reuse the same
 * glyphs and labels without creating an import cycle.
 */
export const CHANNEL_META: Record<ChannelType, ChannelTypeMeta> = {
  webchat: {
    label: 'Web chat',
    glyph: IconInbox,
    description: 'Embed a live chat widget on your site or app.',
    status: 'Live — inbound and replies both work out of the box.',
    addressPlaceholder: 'app.yourdomain.com',
    outbound: { supported: false, urlLabel: '', urlPlaceholder: '', secret: false, help: 'Replies appear in the live widget automatically — no endpoint needed.' },
  },
  email: {
    label: 'Email',
    glyph: IconSend,
    description: 'Forward a support mailbox to turn replies into tickets.',
    status: 'Inbound via forwarding; replies go out over SMTP.',
    addressPlaceholder: 'support@yourdomain.com',
    outbound: { supported: false, urlLabel: '', urlPlaceholder: '', secret: false, help: 'Email replies are delivered from Settings → Email (SMTP).' },
  },
  discord: {
    label: 'Discord',
    glyph: IconContacts,
    description: 'Deliver agent replies straight into a Discord channel.',
    status: 'Reply delivery is live via a channel webhook. Inbound uses a bot/relay.',
    addressPlaceholder: 'Server or channel name',
    outbound: {
      supported: true,
      urlLabel: 'Channel webhook URL',
      urlPlaceholder: 'https://discord.com/api/webhooks/…',
      help: 'In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
      secret: false,
    },
  },
  slack: {
    label: 'Slack',
    glyph: IconCommand,
    description: 'Deliver agent replies into a Slack channel your team watches.',
    status: 'Reply delivery is live via an incoming webhook. Inbound uses the Events API.',
    addressPlaceholder: '#support',
    outbound: {
      supported: true,
      urlLabel: 'Incoming webhook URL',
      urlPlaceholder: 'https://hooks.slack.com/services/…',
      help: 'In Slack: add the Incoming Webhooks app to a channel, then paste its webhook URL.',
      secret: false,
    },
  },
  telegram: {
    label: 'Telegram',
    glyph: IconSend,
    description: 'Reply to customers through a Telegram bot.',
    status: 'Reply delivery via a relay endpoint. Create a bot with @BotFather.',
    addressPlaceholder: 'Bot @handle',
    outbound: relay('telegram', 'to your Telegram bot'),
  },
  whatsapp: {
    label: 'WhatsApp',
    glyph: IconReply,
    description: 'Reply to WhatsApp Business messages as tickets.',
    status: 'Reply delivery via a relay endpoint to the WhatsApp Business API.',
    addressPlaceholder: '+1 555 0100',
    outbound: relay('whatsapp', 'to the WhatsApp Business Send API'),
  },
  messenger: {
    label: 'Messenger',
    glyph: IconReply,
    description: 'Reply to Facebook Messenger conversations.',
    status: 'Reply delivery via a relay endpoint to the Messenger Send API.',
    addressPlaceholder: 'Page name',
    outbound: relay('messenger', 'to the Messenger Send API'),
  },
  sms: {
    label: 'SMS',
    glyph: IconContacts,
    description: 'Reply to text messages from customers.',
    status: 'Reply delivery via a relay endpoint to your SMS gateway.',
    addressPlaceholder: '+1 555 0100',
    outbound: relay('sms', 'to your SMS gateway (Twilio, Vonage, …)'),
  },
  webhook: {
    label: 'Webhook',
    glyph: IconChannels,
    description: 'Post JSON in, and get replies delivered back out to any system.',
    status: 'Live — two-way. Inbound POST in; replies POST back to your URL.',
    addressPlaceholder: 'Label for the source system',
    outbound: {
      supported: true,
      urlLabel: 'Delivery URL',
      urlPlaceholder: 'https://your-system.example.com/basedesk/replies',
      help: 'We POST each agent reply as JSON to this URL.',
      secret: true,
    },
  },
};

/** Display order for the "Add a channel" grid. */
export const CHANNEL_TYPES: ChannelType[] = [
  'webchat',
  'email',
  'discord',
  'slack',
  'telegram',
  'whatsapp',
  'messenger',
  'sms',
  'webhook',
];

const ADDRESS_LABEL = 'Forwarding address / handle';

const FIELD = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2';
const LABEL = 'mb-1.5 block text-[13px] font-medium text-text-2';

/** Compact on/off toggle, shared with the channel cards on ChannelsPage. */
export function Switch({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        enabled ? 'bg-green' : 'bg-surface-3',
      )}
    >
      <span
        className={cx(
          'inline-block h-4 w-4 rounded-full bg-white shadow-1 transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function ChannelDialog({
  open,
  onClose,
  channel,
  presetType,
}: {
  open: boolean;
  onClose: () => void;
  channel?: ChannelConn;
  presetType?: ChannelType;
}) {
  const createChannel = useApp((s) => s.createChannel);
  const updateChannel = useApp((s) => s.updateChannel);
  const deleteChannel = useApp((s) => s.deleteChannel);
  const testChannel = useApp((s) => s.testChannel);

  const editing = channel !== undefined;
  const type: ChannelType = channel?.type ?? presetType ?? 'webchat';
  const meta = CHANNEL_META[type];
  const TypeGlyph = meta.glyph;
  const ob = meta.outbound;

  const [name, setName] = useState(channel?.name ?? meta.label);
  const [address, setAddress] = useState(channel?.address ?? '');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [outboundUrl, setOutboundUrl] = useState(channel?.outboundUrl ?? '');
  const [outboundSecret, setOutboundSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(channel?.hasOutboundSecret ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ChannelTestResult | null>(null);

  const valid = name.trim() !== '';

  /** The outbound fields to include on save (secret is write-only — only sent when typed). */
  function outboundFields(): { outboundUrl?: string; outboundSecret?: string } {
    if (!ob.supported) return {};
    const fields: { outboundUrl?: string; outboundSecret?: string } = { outboundUrl: outboundUrl.trim() };
    if (outboundSecret.trim() !== '') fields.outboundSecret = outboundSecret.trim();
    return fields;
  }

  /** Save the form. Shared by the primary button and the test button. */
  async function persist() {
    const trimmedAddress = address.trim();
    if (channel !== undefined) {
      await updateChannel(channel.id, {
        name: name.trim(),
        enabled,
        address: trimmedAddress === '' ? null : trimmedAddress,
        ...outboundFields(),
      });
    } else {
      await createChannel({
        type,
        name: name.trim(),
        ...(trimmedAddress === '' ? {} : { address: trimmedAddress }),
        ...outboundFields(),
      });
    }
    if (outboundSecret.trim() !== '') {
      setHasSecret(true);
      setOutboundSecret('');
    }
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await persist();
      toast(editing ? 'Channel updated' : `${meta.label} connected`);
      onClose();
    } catch {
      toast('Could not save the channel');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (channel === undefined || busy || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      await persist(); // save first so the server tests the values on screen
      setTestResult(await testChannel(channel.id));
    } catch {
      setTestResult({ ok: false, error: 'Could not run the test' });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (channel === undefined || busy) return;
    setBusy(true);
    try {
      await deleteChannel(channel.id);
      toast('Channel removed');
      onClose();
    } catch {
      toast('Could not remove the channel');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit channel' : `Connect ${meta.label}`} width={480}>
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-text-2">
            <TypeGlyph size={17} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium">{meta.label}</div>
            <div className="truncate text-[12px] text-text-3">{meta.description}</div>
          </div>
        </div>

        <div>
          <label className={LABEL} htmlFor="channel-name">Name</label>
          <input
            id="channel-name"
            className={FIELD}
            placeholder={`${meta.label} — Support`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="channel-address">{ADDRESS_LABEL}</label>
          <input
            id="channel-address"
            className={FIELD}
            placeholder={meta.addressPlaceholder}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="mt-1.5 text-[12px] text-text-3">
            Optional. Where this source forwards from, or a handle to recognise it by.
          </p>
        </div>

        {ob.supported ? (
          <div className="rounded-md border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <IconReply size={14} className="text-text-3" />
              <span className="text-[13px] font-medium">Reply delivery</span>
            </div>
            <label className={LABEL} htmlFor="channel-outbound-url">{ob.urlLabel}</label>
            <input
              id="channel-outbound-url"
              className={`${FIELD} font-mono text-[12px]`}
              placeholder={ob.urlPlaceholder}
              value={outboundUrl}
              onChange={(e) => setOutboundUrl(e.target.value)}
              autoComplete="off"
            />
            {ob.secret && (
              <div className="mt-2.5">
                <label className={LABEL} htmlFor="channel-outbound-secret">Auth token (optional)</label>
                <input
                  id="channel-outbound-secret"
                  type="password"
                  className={FIELD}
                  placeholder={hasSecret ? '•••••••••• (stored — leave blank to keep)' : 'Sent as a Bearer token'}
                  value={outboundSecret}
                  onChange={(e) => setOutboundSecret(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
            <p className="mt-1.5 text-[12px] text-text-3">{ob.help}</p>
            {editing && (
              <div className="mt-2.5 flex items-center gap-2.5">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => void test()}
                  disabled={testing || outboundUrl.trim() === ''}
                >
                  {testing ? 'Sending…' : 'Send test'}
                </Button>
                {testResult !== null && (
                  <span className={cx('text-[12px]', testResult.ok ? 'text-green' : 'text-red')}>
                    {testResult.ok ? 'Test delivered ✓' : `Failed: ${testResult.error ?? 'unknown error'}`}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          ob.help !== '' && (
            <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-text-3">{ob.help}</p>
          )
        )}

        {editing && (
          <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
            <span className="text-[13px] font-medium text-text-2">Enabled</span>
            <Switch
              enabled={enabled}
              onToggle={() => setEnabled((v) => !v)}
              label={enabled ? 'Disable channel' : 'Enable channel'}
            />
          </div>
        )}

        <div className="mt-1 flex items-center justify-between">
          {editing ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-[13px] text-text-2">
                Remove?
                <button type="button" className="font-medium text-red hover:underline" onClick={() => void remove()}>
                  Yes
                </button>
                <button type="button" className="text-text-3 hover:text-text" onClick={() => setConfirmDelete(false)}>
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-[13px] font-medium text-red hover:underline"
                onClick={() => setConfirmDelete(true)}
              >
                Remove
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!valid || busy} onClick={() => void save()}>
              {editing ? 'Save' : 'Connect'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
