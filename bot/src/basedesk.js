import crypto from 'node:crypto';

/**
 * Thin client for a BaseDesk instance, scoped to one channel. All writes go
 * through the channel's token- (and optionally HMAC-) secured inbound/command
 * endpoints — the same ones documented in docs/channels.md.
 */
export class BaseDesk {
  constructor({ url, channelId, inboundToken, signingSecret }) {
    this.url = url.replace(/\/+$/, '');
    this.channelId = channelId;
    this.inboundToken = inboundToken;
    this.signingSecret = signingSecret || '';
  }

  #headers(raw) {
    const headers = { 'content-type': 'application/json' };
    if (this.signingSecret) {
      headers['x-basedesk-signature'] = crypto.createHmac('sha256', this.signingSecret).update(raw).digest('hex');
    }
    return headers;
  }

  async #post(path, body) {
    const raw = JSON.stringify(body);
    const res = await fetch(`${this.url}${path}?token=${this.inboundToken}`, {
      method: 'POST',
      headers: this.#headers(raw),
      body: raw,
    });
    if (!res.ok) throw new Error(`BaseDesk ${path} → ${res.status} ${await res.text().catch(() => '')}`);
    return res.json();
  }

  /** Provision a fresh Discord channel in BaseDesk. Returns { id, inboundToken, ... }. */
  static async createChannel(url, name) {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/channels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'discord', name }),
    });
    if (!res.ok) throw new Error(`create channel → ${res.status}`);
    return res.json();
  }

  /** Point the channel's outbound delivery at a URL (used only in webhook mode). */
  async setOutboundUrl(outboundUrl) {
    const res = await fetch(`${this.url}/api/channels/${this.channelId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outboundUrl }),
    });
    if (!res.ok) throw new Error(`set outbound → ${res.status}`);
    return res.json();
  }

  /** A customer message arrives — creates or threads a ticket. */
  inbound({ externalId, name, body, subject }) {
    return this.#post(`/api/channels/${this.channelId}/inbound`, { from: { externalId, name }, body, subject });
  }

  /** Manage a ticket: action = reply | solve | close | reopen | status. */
  command(action, ticket, text) {
    return this.#post(`/api/channels/${this.channelId}/command`, { action, ticket, ...(text ? { text } : {}) });
  }

  /** Read a ticket thread (used to deliver agent replies back to Discord). */
  async messages(ticketId) {
    const res = await fetch(`${this.url}/api/tickets/${encodeURIComponent(ticketId)}/messages`);
    if (!res.ok) throw new Error(`messages → ${res.status}`);
    return res.json();
  }
}
