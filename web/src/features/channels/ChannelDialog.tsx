import { useState, type ComponentType } from 'react';
import { useApp } from '../../data/store';
import type { ChannelConn, ChannelType } from '../../data/types';
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

export interface ChannelTypeMeta {
  label: string;
  glyph: Glyph;
  description: string;
  /** True when the connector is fully live; false for infra-dependent types. */
  live: boolean;
  addressPlaceholder: string;
}

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
    live: true,
    addressPlaceholder: 'app.yourdomain.com',
  },
  email: {
    label: 'Email',
    glyph: IconSend,
    description: 'Forward a support mailbox to turn replies into tickets.',
    live: false,
    addressPlaceholder: 'support@yourdomain.com',
  },
  discord: {
    label: 'Discord',
    glyph: IconContacts,
    description: 'Raise tickets from messages in your Discord server.',
    live: false,
    addressPlaceholder: 'Server or channel ID',
  },
  slack: {
    label: 'Slack',
    glyph: IconCommand,
    description: 'Open tickets from a Slack channel your team watches.',
    live: false,
    addressPlaceholder: '#support',
  },
  whatsapp: {
    label: 'WhatsApp',
    glyph: IconReply,
    description: 'Collect WhatsApp Business messages as tickets.',
    live: false,
    addressPlaceholder: '+1 555 0100',
  },
  webhook: {
    label: 'Webhook',
    glyph: IconChannels,
    description: 'Post JSON from any system to open tickets programmatically.',
    live: true,
    addressPlaceholder: 'Label for the source system',
  },
};

/** Display order for the "Add a channel" grid. */
export const CHANNEL_TYPES: ChannelType[] = [
  'webchat',
  'email',
  'discord',
  'slack',
  'whatsapp',
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

  const editing = channel !== undefined;
  const type: ChannelType = channel?.type ?? presetType ?? 'webchat';
  const meta = CHANNEL_META[type];
  const TypeGlyph = meta.glyph;

  const [name, setName] = useState(channel?.name ?? meta.label);
  const [address, setAddress] = useState(channel?.address ?? '');
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = name.trim() !== '';

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    const trimmedAddress = address.trim();
    try {
      if (editing) {
        await updateChannel(channel.id, {
          name: name.trim(),
          enabled,
          address: trimmedAddress === '' ? null : trimmedAddress,
        });
        toast('Channel updated');
      } else {
        await createChannel({
          type,
          name: name.trim(),
          ...(trimmedAddress === '' ? {} : { address: trimmedAddress }),
        });
        toast(`${meta.label} connected`);
      }
      onClose();
    } catch {
      toast('Could not save the channel');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || busy) return;
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
