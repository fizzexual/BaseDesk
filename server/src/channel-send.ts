import type { ChannelConn } from './types.js';

/**
 * Outbound delivery for chat channels. When an agent (or an AI agent) replies to
 * a ticket that arrived over Discord, Slack, or a relayed channel, the reply is
 * POSTed back out to that channel's configured endpoint so the customer actually
 * sees it where they wrote from.
 *
 * Zero dependencies: each provider is just a differently-shaped JSON body sent
 * with `fetch`. Discord and Slack accept their native incoming-webhook payloads
 * directly; every other type receives a generic envelope that a small relay
 * (Telegram bot, Messenger/WhatsApp Send API, an SMS gateway) forwards on.
 */

export interface OutboundMessage {
  ticketNumber: number;
  subject: string;
  body: string;
  /** The customer's display name, when known. */
  toName: string | null;
  /** The replying agent / support brand name. */
  fromName: string;
}

export interface ChannelSendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

// Discord hard-caps message content at 2000 chars; stay under it with headroom.
const DISCORD_LIMIT = 1900;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Build the provider-specific request body + headers for an outgoing reply. */
function buildRequest(channel: ChannelConn, msg: OutboundMessage): { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const secret = channel.outboundSecret?.trim();
  if (secret) headers.authorization = `Bearer ${secret}`;

  switch (channel.type) {
    case 'discord':
      // Discord incoming webhook: { content }. Markdown is supported.
      return { headers, body: JSON.stringify({ content: clip(`**Re: ${msg.subject}**\n${msg.body}`, DISCORD_LIMIT) }) };
    case 'slack':
      // Slack incoming webhook: { text }. mrkdwn is supported.
      return { headers, body: JSON.stringify({ text: `*Re: ${msg.subject}*\n${msg.body}` }) };
    default:
      // Generic relay envelope for telegram / messenger / whatsapp / sms / webhook / email.
      return {
        headers,
        body: JSON.stringify({
          channel: channel.type,
          channelId: channel.id,
          ticketNumber: msg.ticketNumber,
          to: msg.toName,
          from: msg.fromName,
          subject: msg.subject,
          text: msg.body,
        }),
      };
  }
}

/** True when this channel is enabled and has somewhere to deliver replies. */
export function channelCanSend(channel: ChannelConn): boolean {
  return channel.enabled && (channel.outboundUrl?.trim() ?? '') !== '';
}

/** Deliver a single reply to a channel's outbound endpoint. Never throws. */
export async function sendToChannel(
  channel: ChannelConn,
  msg: OutboundMessage,
  opts: { timeoutMs?: number } = {},
): Promise<ChannelSendResult> {
  const url = channel.outboundUrl?.trim();
  if (!url) return { ok: false, error: 'no outbound URL configured' };

  const { body, headers } = buildRequest(channel, msg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `HTTP ${res.status}${text.trim() ? `: ${clip(text.trim(), 140)}` : ''}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, error: 'request timed out' };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
