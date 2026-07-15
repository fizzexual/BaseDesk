import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-brand-'))).app;
}
type App = ReturnType<typeof makeApp>;
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Branding = { productName: string; accentColor: string };
const publicBranding = async (app: App) => (await (await app.request('/api/portal/branding')).json()) as Branding;
const bootBranding = async (app: App) => ((await (await app.request('/api/bootstrap')).json()).branding) as Branding;

describe('branding', () => {
  it('defaults to BaseDesk with no custom accent', async () => {
    const app = makeApp();
    expect(await bootBranding(app)).toEqual({ productName: 'BaseDesk', accentColor: '' });
    expect(await publicBranding(app)).toEqual({ productName: 'BaseDesk', accentColor: '' });
  });

  it('saves a product name and accent, reflected publicly and in bootstrap', async () => {
    const app = makeApp();
    const saved = (await (await put(app, '/api/settings/branding', { productName: 'Acme Support', accentColor: '#4f46e5' })).json()) as Branding;
    expect(saved).toEqual({ productName: 'Acme Support', accentColor: '#4f46e5' });
    expect(await publicBranding(app)).toEqual({ productName: 'Acme Support', accentColor: '#4f46e5' });
    expect(await bootBranding(app)).toEqual({ productName: 'Acme Support', accentColor: '#4f46e5' });
  });

  it('coerces a blank name to the default and rejects a non-hex accent', async () => {
    const app = makeApp();
    const saved = (await (await put(app, '/api/settings/branding', { productName: '   ', accentColor: 'not-a-color' })).json()) as Branding;
    expect(saved.productName).toBe('BaseDesk');
    expect(saved.accentColor).toBe('');
  });
});
