import { describe, expect, it } from 'vitest';
import seedJson from '../../shared/seed.json';
import { LocalRepository } from '../src/data/local';
import { createAppStore } from '../src/data/store';
import type { Repository } from '../src/data/repository';
import type { Counts, Ticket } from '../src/data/types';

const seedTickets = seedJson.tickets as unknown as Ticket[];
const ACTIVE: readonly string[] = ['open', 'pending', 'on_hold'];

function memStorage() {
  const map = new Map<string, string>();
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

async function freshStore(repository?: Repository) {
  const store = createAppStore(repository ?? new LocalRepository(memStorage()));
  await store.getState().init();
  return store;
}

function isSnoozed(t: Ticket, now: string): boolean {
  return t.snoozedUntil !== null && t.snoozedUntil > now;
}

/** Expected counts derived from the seed dataset with the shared view semantics. */
function expectedCounts(now: string): Counts {
  const c: Counts = {
    all: 0, unassigned: 0, mine: 0, snoozed: 0,
    open: 0, pending: 0, on_hold: 0, solved: 0, closed: 0,
    archive: 0, spam: 0, trash: 0,
  };
  for (const t of seedTickets) {
    if (t.bucket === 'archive') c.archive += 1;
    if (t.bucket === 'spam') c.spam += 1;
    if (t.bucket === 'trash') c.trash += 1;
    if (t.bucket !== 'inbox') continue;
    if (isSnoozed(t, now)) {
      c.snoozed += 1;
      continue;
    }
    c[t.status] += 1;
    if (t.status !== 'closed') {
      c.all += 1;
      if (t.assigneeId === null && (t.status === 'open' || t.status === 'pending')) c.unassigned += 1;
      if (t.assigneeId === 'a_1' && ACTIVE.includes(t.status)) c.mine += 1;
    }
  }
  return c;
}

describe('store', () => {
  it('init hydrates entities and marks ready', async () => {
    const store = await freshStore();
    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(Object.keys(s.tickets)).toHaveLength(seedJson.tickets.length);
    expect(Object.keys(s.contacts)).toHaveLength(seedJson.contacts.length);
    expect(Object.keys(s.agents)).toHaveLength(seedJson.agents.length);
    expect(s.canned).toHaveLength(seedJson.canned.length);
    expect(s.currentAgentId).toBe('a_1');
  });

  it('counts match the seed distribution exactly', async () => {
    const store = await freshStore();
    const now = new Date().toISOString();
    expect(store.getState().counts()).toEqual(expectedCounts(now));
  });

  it("ticketsForView('mine') returns only the current agent's active, unsnoozed inbox tickets", async () => {
    const store = await freshStore();
    const now = new Date().toISOString();
    const mine = store.getState().ticketsForView('mine');
    const expectedIds = seedTickets
      .filter(
        (t) =>
          t.bucket === 'inbox' &&
          !isSnoozed(t, now) &&
          t.assigneeId === 'a_1' &&
          ACTIVE.includes(t.status),
      )
      .map((t) => t.id)
      .sort();
    expect(mine.map((t) => t.id).sort()).toEqual(expectedIds);
    for (const t of mine) {
      expect(t.bucket).toBe('inbox');
      expect(t.assigneeId).toBe('a_1');
      expect(ACTIVE).toContain(t.status);
      expect(isSnoozed(t, now)).toBe(false);
    }
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i - 1].lastMessageAt >= mine[i].lastMessageAt).toBe(true);
    }
  });

  it("a snoozed ticket is absent from 'all' but present in 'snoozed'", async () => {
    const store = await freshStore();
    const target = store.getState().ticketsForView('all')[0];
    const until = new Date(Date.now() + 86_400_000).toISOString();
    await store.getState().patchTicket(target.id, { snoozedUntil: until });
    expect(store.getState().ticketsForView('all').map((t) => t.id)).not.toContain(target.id);
    expect(store.getState().ticketsForView('snoozed').map((t) => t.id)).toContain(target.id);
  });

  it('patchTicket rolls back the optimistic update when the repository rejects', async () => {
    const local = new LocalRepository(memStorage());
    const failing: Repository = {
      bootstrap: () => local.bootstrap(),
      getMessages: (ticketId) => local.getMessages(ticketId),
      createTicket: (input) => local.createTicket(input),
      updateTicket: () => Promise.reject(new Error('write failed')),
      addMessage: (ticketId, input) => local.addMessage(ticketId, input),
      createContact: (input) => local.createContact(input),
      saveCanned: (c) => local.saveCanned(c),
      deleteCanned: (id) => local.deleteCanned(id),
      getStats: () => local.getStats(),
      search: (q) => local.search(q),
    };
    const store = await freshStore(failing);
    const target = store.getState().ticketsForView('open')[0];
    const before = { ...target, tags: [...target.tags] };
    await expect(store.getState().patchTicket(target.id, { status: 'solved' })).rejects.toThrow(
      'write failed',
    );
    expect(store.getState().tickets[target.id]).toEqual(before);
  });

  it('sendMessage reply flips open to pending and updates the preview', async () => {
    const store = await freshStore();
    const open = store.getState().ticketsForView('open')[0];
    expect(open.status).toBe('open');
    await store.getState().loadMessages(open.id);
    const countBefore = store.getState().messages[open.id].length;
    const body =
      'Thanks for the details.\n\nWe   have shipped a replacement unit with express delivery, and the tracking number will land in your inbox within the hour.';
    await store.getState().sendMessage(open.id, 'reply', body);
    const after = store.getState();
    const ticket = after.tickets[open.id];
    expect(ticket.status).toBe('pending');
    expect(ticket.lastMessagePreview).toBe(body.replace(/\s+/g, ' ').trim().slice(0, 90));
    const msgs = after.messages[open.id];
    expect(msgs).toHaveLength(countBefore + 1);
    const last = msgs[msgs.length - 1];
    expect(last.kind).toBe('reply');
    expect(last.authorKind).toBe('agent');
    expect(last.authorId).toBe('a_1');
    expect(last.id.startsWith('tmp_')).toBe(false);
    expect(ticket.lastMessageAt).toBe(last.at);
  });

  it('searchLocal finds tickets by contact name, case-insensitively', async () => {
    const store = await freshStore();
    const s = store.getState();
    const ticket = s.ticketsForView('all')[0];
    const contact = s.contacts[ticket.requesterId];
    const results = s.searchLocal(contact.name.toUpperCase());
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);
    expect(results.some((t) => t.requesterId === contact.id)).toBe(true);
  });
});
