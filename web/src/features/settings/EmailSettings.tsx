import { useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { SmtpTestResult } from '../../data/types';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

export function EmailSettings() {
  const smtp = useApp((s) => s.smtp);
  const saveSmtp = useApp((s) => s.saveSmtp);
  const testSmtp = useApp((s) => s.testSmtp);

  const [enabled, setEnabled] = useState(smtp.enabled);
  const [host, setHost] = useState(smtp.host);
  const [port, setPort] = useState(String(smtp.port));
  const [secure, setSecure] = useState(smtp.secure);
  const [user, setUser] = useState(smtp.user);
  const [pass, setPass] = useState('');
  const [hasPass, setHasPass] = useState(smtp.hasPass);
  const [fromName, setFromName] = useState(smtp.fromName);
  const [fromEmail, setFromEmail] = useState(smtp.fromEmail);
  const [publicUrl, setPublicUrl] = useState(smtp.publicUrl);
  const [testTo, setTestTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<SmtpTestResult | null>(null);

  function payload() {
    const p = Number(port);
    return {
      enabled,
      host: host.trim(),
      port: Number.isFinite(p) && p > 0 ? p : 587,
      secure,
      user: user.trim(),
      fromName: fromName.trim() || 'Support',
      fromEmail: fromEmail.trim(),
      publicUrl: publicUrl.trim(),
      ...(pass.trim() !== '' ? { pass: pass.trim() } : {}),
    };
  }

  async function onSave() {
    setSaving(true);
    try {
      await saveSmtp(payload());
      if (pass.trim() !== '') setHasPass(true);
      setPass('');
      toast('Email settings saved');
    } catch {
      toast('Could not save email settings');
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTest(null);
    try {
      // Save first so the server tests the current form values.
      await saveSmtp(payload());
      if (pass.trim() !== '') setHasPass(true);
      setPass('');
      setTest(await testSmtp(testTo.trim()));
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : 'send failed' });
    } finally {
      setTesting(false);
    }
  }

  const active = enabled && host.trim() !== '' && fromEmail.trim() !== '';

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Email notifications</h2>
          <p className="mt-2 text-[13px] text-text-3">
            Connect an SMTP server to email customers when an agent replies, with a link back to the
            portal. The password is stored on your server and never sent to the browser.
          </p>
        </div>
        <div className="mt-0.5 shrink-0">
          <Switch enabled={enabled} onToggle={() => setEnabled(!enabled)} label="Enable email notifications" />
        </div>
      </div>

      <div className={cx('mt-5 flex flex-col gap-4', !enabled && 'opacity-60')}>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-[3] flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              <Tooltip
                title="SMTP host"
                label="The outgoing mail server that sends your notification emails — your email provider gives you this address."
              >
                SMTP host
              </Tooltip>
            </span>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.provider.com" className={`${FIELD} font-mono text-[13px]`} />
          </label>
          <label className="flex w-24 shrink-0 flex-col gap-1.5">
            <span className="text-[13px] font-medium">Port</span>
            <input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" className={`${FIELD} tabular-nums`} />
          </label>
        </div>

        <label className="flex items-start gap-2.5 rounded-md border border-line p-2.5">
          <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-green" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Implicit TLS (SSL)</span>
            <span className="block text-[12px] text-text-3">On for port 465. Off for 587/25, which upgrades with STARTTLS when the server supports it.</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-medium">Username</span>
            <input type="text" value={user} onChange={(e) => setUser(e.target.value)} placeholder="apikey or user" className={FIELD} autoComplete="off" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-medium">Password</span>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={hasPass ? '•••••••••• (stored — leave blank to keep)' : 'SMTP password'}
              className={FIELD}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              <Tooltip
                title="From name"
                label="The sender name customers see in their inbox, like “Acme Support” — separate from your SMTP login."
              >
                From name
              </Tooltip>
            </span>
            <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Acme Support" className={FIELD} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-medium">From email</span>
            <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="support@acme.com" className={FIELD} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Portal URL</span>
          <input type="text" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://support.acme.com" className={`${FIELD} font-mono text-[13px]`} />
          <span className="text-[12px] text-text-3">The public base URL of the customer portal — used for links in emails.</span>
        </label>

        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-medium">Send a test email to</span>
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={fromEmail || 'you@example.com'} className={FIELD} />
          </label>
          <Button variant="subtle" size="sm" onClick={() => void onTest()} disabled={testing}>
            {testing ? 'Sending…' : 'Send test'}
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save email settings'}
        </Button>
      </div>

      {test !== null && (
        <div
          className={cx(
            'mt-3 rounded-md border px-3 py-2 text-[13px]',
            test.ok ? 'border-green/30 bg-green-bg text-green' : 'border-red/30 bg-red-bg text-red',
          )}
        >
          {test.ok ? `Test email sent to ${test.to ?? testTo}` : `Send failed: ${test.error ?? 'unknown error'}`}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-[13px]">
        <span className={cx('inline-block size-2 rounded-full', active ? 'bg-green' : 'bg-gray-dot')} />
        <span className="text-text-2">
          {active ? 'Email notifications are on' : 'Email is off — customers are not notified of replies'}
        </span>
      </div>
    </section>
  );
}
