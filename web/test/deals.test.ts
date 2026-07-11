import { describe, expect, it } from 'vitest';
import seedJson from '../../shared/seed.json';
import { LocalRepository } from '../src/data/local';
import { createAppStore } from '../src/data/store';
import type { Repository } from '../src/data/repository';
import type { Deal } from '../src/data/types';

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

const seedDeals = seedJson.deals as unknown as Deal[];

describe('deal store', () => {
  it('hydrates deals from the seed', async () => {
    const store = await freshStore();
    expect(Object.keys(store.getState().deals).length).toBe(seedDeals.length);
  });

  it('createDeal adds and returns an id', async () => {
    const store = await freshStore();
    const contactId = seedJson.contacts[0]!.id;
    const before = Object.keys(store.getState().deals).length;
    const id = await store.getState().createDeal({ title: 'New expansion', type: 'expansion', value: 120000, contactId });
    expect(store.getState().deals[id]).toBeDefined();
    expect(Object.keys(store.getState().deals).length).toBe(before + 1);
    expect(store.getState().deals[id]!.stage).toBe('open');
  });

  it('updateDeal to won sets closedAt', async () => {
    const store = await freshStore();
    const contactId = seedJson.contacts[0]!.id;
    const id = await store.getState().createDeal({ title: 'X', type: 'inbound', value: 1000, contactId });
    await store.getState().updateDeal(id, { stage: 'won' });
    expect(store.getState().deals[id]!.closedAt).not.toBeNull();
  });

  it('rolls back updateDeal when the repository rejects', async () => {
    const base = new LocalRepository(memStorage());
    const failing: Repository = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      updateDeal: () => Promise.reject(new Error('boom')),
    });
    const store = await freshStore(failing);
    const id = Object.keys(store.getState().deals)[0]!;
    const prevStage = store.getState().deals[id]!.stage;
    await expect(store.getState().updateDeal(id, { stage: 'lost' })).rejects.toThrow('boom');
    expect(store.getState().deals[id]!.stage).toBe(prevStage);
  });

  it('rolls back deleteDeal when the repository rejects', async () => {
    const base = new LocalRepository(memStorage());
    const failing: Repository = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      deleteDeal: () => Promise.reject(new Error('nope')),
    });
    const store = await freshStore(failing);
    const id = Object.keys(store.getState().deals)[0]!;
    await expect(store.getState().deleteDeal(id)).rejects.toThrow('nope');
    expect(store.getState().deals[id]).toBeDefined();
  });

  it('dealsForContact returns only that contact, newest first', async () => {
    const store = await freshStore();
    const contactId = seedDeals[0]!.contactId;
    const list = store.getState().dealsForContact(contactId);
    expect(list.every((d) => d.contactId === contactId)).toBe(true);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.updatedAt >= list[i]!.updatedAt).toBe(true);
    }
  });

  it('accounts groups by company with at_risk precedence', async () => {
    const store = await freshStore();
    const accounts = store.getState().accounts();
    expect(accounts.length).toBeGreaterThan(0);
    // Every account has a company and a valid status.
    for (const a of accounts) {
      expect(a.company).toBeTruthy();
      expect(['at_risk', 'expansion_ready', 'healthy']).toContain(a.status);
    }
    // at_risk accounts sort before healthy ones.
    const firstHealthy = accounts.findIndex((a) => a.status === 'healthy');
    const lastAtRisk = accounts.map((a) => a.status).lastIndexOf('at_risk');
    if (firstHealthy !== -1 && lastAtRisk !== -1) {
      expect(lastAtRisk).toBeLessThan(firstHealthy);
    }
  });

  it('classifies an account with an open retention deal as at_risk', async () => {
    const store = await freshStore();
    const contactId = seedJson.contacts.find((c) => c.company !== null)!.id;
    const company = store.getState().contacts[contactId]!.company;
    await store.getState().createDeal({ title: 'Renewal', type: 'retention', value: 500000, contactId });
    const account = store.getState().accounts().find((a) => a.company === company);
    expect(account?.status).toBe('at_risk');
  });
});
