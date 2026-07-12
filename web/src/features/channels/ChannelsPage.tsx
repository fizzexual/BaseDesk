import { useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import type { ChannelConn, ChannelType } from '../../data/types';
import { Button } from '../../components/Button';
import { Menu, type MenuItem } from '../../components/Menu';
import { toast } from '../../components/Toast';
import { IconDots, IconTrash } from '../../icons';
import { CHANNEL_META, CHANNEL_TYPES, ChannelDialog, Switch } from './ChannelDialog';

type DialogState = { channel?: ChannelConn; presetType?: ChannelType } | null;

const INFRA_NOTE =
  'Inbound works via forwarding/webhook now — native connector and outbound delivery arrive in a hosted deploy.';

function inboundUrl(channel: ChannelConn): string {
  return `${window.location.origin}/api/channels/${channel.id}/inbound?token=${channel.inboundToken}`;
}

function widgetUrl(channel: ChannelConn): string {
  return `${window.location.origin}/widget.html?channel=${channel.id}&token=${channel.inboundToken}`;
}

function embedCode(channel: ChannelConn): string {
  return `<iframe src="${widgetUrl(channel)}" style="border:0;width:100%;height:520px"></iframe>`;
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Could not copy to the clipboard');
  }
}

function ConnectedChannel({
  channel,
  ticketCount,
  onEdit,
}: {
  channel: ChannelConn;
  ticketCount: number;
  onEdit: () => void;
}) {
  const updateChannel = useApp((s) => s.updateChannel);
  const deleteChannel = useApp((s) => s.deleteChannel);
  const meta = CHANNEL_META[channel.type];
  const Glyph = meta.glyph;

  async function toggle() {
    try {
      await updateChannel(channel.id, { enabled: !channel.enabled });
    } catch {
      toast('Could not update the channel');
    }
  }

  async function remove() {
    try {
      await deleteChannel(channel.id);
      toast('Channel removed');
    } catch {
      toast('Could not remove the channel');
    }
  }

  const menuItems: MenuItem[] = [
    { label: 'Edit', onSelect: onEdit },
    { separator: true },
    { label: 'Delete', icon: <IconTrash size={15} />, danger: true, onSelect: () => void remove() },
  ];

  const url = inboundUrl(channel);

  return (
    <div className="rounded-md border border-line p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-2">
          <Glyph size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium">{channel.name}</span>
            {!channel.enabled && <span className="shrink-0 text-[12px] text-text-3">Off</span>}
          </div>
          <div className="mt-0.5 text-[13px] text-text-3 tabular-nums">
            {meta.label} · {ticketCount} ticket{ticketCount === 1 ? '' : 's'}
          </div>
        </div>
        <Switch
          enabled={channel.enabled}
          onToggle={() => void toggle()}
          label={`${channel.enabled ? 'Disable' : 'Enable'} ${channel.name}`}
        />
        <Menu
          align="end"
          triggerLabel="Channel actions"
          triggerClassName="inline-flex size-8 items-center justify-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          trigger={<IconDots size={16} />}
          items={menuItems}
        />
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-[12px] font-medium text-text-3">Inbound URL</span>
        <div className="flex items-center gap-2">
          <input
            readOnly
            aria-label={`Inbound URL for ${channel.name}`}
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-text-2 outline-none focus:border-line-2"
          />
          <Button variant="subtle" size="sm" onClick={() => void copy(url, 'Inbound URL copied')}>
            Copy
          </Button>
        </div>
      </div>

      {channel.type === 'webchat' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
          <a
            href={widgetUrl(channel)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-text-2 underline-offset-2 hover:text-text hover:underline"
          >
            Preview widget
          </a>
          <button
            type="button"
            className="font-medium text-text-2 hover:text-text"
            onClick={() => void copy(embedCode(channel), 'Embed code copied')}
          >
            Copy embed code
          </button>
        </div>
      )}
    </div>
  );
}

export function ChannelsPage() {
  const channels = useApp((s) => s.channels);
  const tickets = useApp((s) => s.tickets);
  const [dialog, setDialog] = useState<DialogState>(null);

  const connected = useMemo(
    () => Object.values(channels).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [channels],
  );

  const ticketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of Object.values(tickets)) {
      if (t.channelId !== null) counts[t.channelId] = (counts[t.channelId] ?? 0) + 1;
    }
    return counts;
  }, [tickets]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="shrink-0 text-[15px] font-semibold">Channels</h1>
        <span className="truncate text-[13px] text-text-3">
          Connect and configure where your tickets come from
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[860px]">
          <section>
            <h2 className="text-[15px] font-semibold">Connected</h2>
            {connected.length === 0 ? (
              <p className="mt-2 text-[13px] text-text-3">No channels connected yet. Add one below.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {connected.map((channel) => (
                  <ConnectedChannel
                    key={channel.id}
                    channel={channel}
                    ticketCount={ticketCounts[channel.id] ?? 0}
                    onEdit={() => setDialog({ channel })}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-[15px] font-semibold">Add a channel</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CHANNEL_TYPES.map((type) => {
                const meta = CHANNEL_META[type];
                const Glyph = meta.glyph;
                return (
                  <div key={type} className="flex flex-col rounded-md border border-line p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-2">
                        <Glyph size={18} />
                      </span>
                      <span className="text-[14px] font-medium">{meta.label}</span>
                    </div>
                    <p className="mt-2.5 text-[13px] text-text-2">{meta.description}</p>
                    <p className="mt-1.5 text-[12px] text-text-3">{meta.live ? 'Live now.' : INFRA_NOTE}</p>
                    <div className="mt-auto flex pt-3.5">
                      <Button variant="subtle" size="sm" onClick={() => setDialog({ presetType: type })}>
                        Connect
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {dialog !== null && (
        <ChannelDialog
          key={dialog.channel?.id ?? dialog.presetType ?? 'new'}
          open
          onClose={() => setDialog(null)}
          channel={dialog.channel}
          presetType={dialog.presetType}
        />
      )}
    </div>
  );
}
