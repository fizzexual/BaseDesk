import fs from 'node:fs';

const FILE = new URL('../bot-state.json', import.meta.url);

/**
 * Tiny JSON-file store. Holds the provisioned BaseDesk channel (so we don't
 * re-create it on restart) and the Discord-thread ↔ BaseDesk-ticket mapping,
 * including which agent messages have already been delivered back to Discord.
 *
 * Shape:
 * {
 *   channel: { id, inboundToken },
 *   threads: { [threadId]: { ticketId, ticketNumber, openerId, delivered: [msgId] } }
 * }
 */
export function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!data.threads) data.threads = {};
    return data;
  } catch {
    return { channel: null, threads: {} };
  }
}

export function save(state) {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}
