import { useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import { IconCheck, IconCheckCircle } from '../../icons';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

/** Set the admin password, require sign-in, and manage two-factor. All opt-in. */
export function SecuritySettings() {
  const auth = useApp((s) => s.auth);
  const logout = useApp((s) => s.logout);
  const setAdminPassword = useApp((s) => s.setAdminPassword);
  const setup2fa = useApp((s) => s.setup2fa);
  const enable2fa = useApp((s) => s.enable2fa);
  const disable2fa = useApp((s) => s.disable2fa);
  const setAuthRequired = useApp((s) => s.setAuthRequired);

  // Password fields
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  // Require-login toggle
  const [toggling, setToggling] = useState(false);

  // 2FA setup flow
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string>('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const pwValid = pw.length >= 8 && pw === pw2;

  async function savePassword() {
    if (!pwValid) return;
    setSavingPw(true);
    try {
      await setAdminPassword(pw);
      setPw('');
      setPw2('');
      toast(auth.hasPassword ? 'Password updated' : 'Admin password set');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the password');
    } finally {
      setSavingPw(false);
    }
  }

  async function toggleRequire() {
    setToggling(true);
    try {
      await setAuthRequired(!auth.enabled);
      // When turning it on the app sends us to the sign-in screen; no toast needed there.
      if (auth.enabled) toast('Sign-in is no longer required');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the setting');
    } finally {
      setToggling(false);
    }
  }

  async function beginSetup() {
    try {
      const s = await setup2fa();
      setSecret(s.secret);
      setUri(s.uri);
      setCode('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start 2FA setup');
    }
  }

  async function verify() {
    if (code.trim().length < 6) return;
    setVerifying(true);
    try {
      await enable2fa(code.trim());
      setSecret(null);
      setUri('');
      setCode('');
      toast('Two-factor authentication is on');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That code did not match — try the next one');
    } finally {
      setVerifying(false);
    }
  }

  async function turnOff2fa() {
    try {
      await disable2fa();
      toast('Two-factor turned off');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not turn off 2FA');
    }
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">Security</h2>
      <p className="mt-2 text-[13px] text-text-3">
        Protect the agent workspace with a password and optional two-factor. The customer portal
        stays public — these settings only guard the admin side.
      </p>

      {/* Admin password */}
      <div className="mt-6">
        <h3 className="text-[14px] font-semibold">Admin password</h3>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-text-2">
          {auth.hasPassword ? (
            <>
              <IconCheck size={14} className="text-green" /> A password is set.
            </>
          ) : (
            'No password yet — set one before you can require sign-in.'
          )}
        </p>
        <div className="mt-3 flex flex-col gap-2.5">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={auth.hasPassword ? 'New password' : 'Choose a password (min 8 characters)'}
            autoComplete="new-password"
            className={FIELD}
          />
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className={FIELD}
          />
          {pw !== '' && pw.length < 8 && <span className="text-[12px] text-amber">Use at least 8 characters.</span>}
          {pw2 !== '' && pw !== pw2 && <span className="text-[12px] text-red">Passwords don’t match.</span>}
          <div>
            <Button variant="primary" size="sm" onClick={() => void savePassword()} disabled={!pwValid || savingPw}>
              {savingPw ? 'Saving…' : auth.hasPassword ? 'Update password' : 'Set password'}
            </Button>
          </div>
        </div>
      </div>

      {/* Require sign-in */}
      <div className="mt-8 flex items-center justify-between gap-4 rounded-lg border border-line p-3.5">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">Require sign-in for the workspace</div>
          <div className="mt-0.5 text-[13px] text-text-2">
            When on, agents must sign in to open the dashboard. You’ll be asked to sign in right after enabling.
          </div>
        </div>
        <Switch
          enabled={auth.enabled}
          onToggle={() => void toggleRequire()}
          disabled={toggling || (!auth.hasPassword && !auth.enabled)}
          label="Require sign-in"
        />
      </div>
      {!auth.hasPassword && (
        <p className="mt-2 text-[12px] text-text-3">Set an admin password first to turn this on.</p>
      )}

      {/* Two-factor */}
      <div className="mt-8">
        <h3 className="text-[14px] font-semibold">Two-factor authentication</h3>
        {auth.totpEnabled ? (
          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-green/30 bg-green-bg p-3.5">
            <div className="flex items-center gap-2 text-[13px] text-green">
              <IconCheckCircle size={15} /> Enabled — a 6-digit code from your authenticator is required at sign-in.
            </div>
            <Button variant="ghost" size="sm" onClick={() => void turnOff2fa()}>
              Turn off
            </Button>
          </div>
        ) : secret === null ? (
          <div className="mt-2">
            <p className="text-[13px] text-text-2">
              Add a time-based one-time code (TOTP) on top of your password, using any authenticator app.
            </p>
            <Button variant="subtle" size="sm" className="mt-3" onClick={() => void beginSetup()} disabled={!auth.hasPassword}>
              Set up two-factor
            </Button>
            {!auth.hasPassword && <p className="mt-2 text-[12px] text-text-3">Set an admin password first.</p>}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-line p-4">
            <p className="text-[13px] text-text-2">
              1. In your authenticator app, add an account and enter this setup key:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="select-all rounded bg-surface-2 px-2 py-1 font-mono text-[13px] tracking-wider">{secret}</code>
              <button
                type="button"
                className="text-[12px] font-medium text-accent hover:underline"
                onClick={() => {
                  void navigator.clipboard?.writeText(secret).then(() => toast('Setup key copied'));
                }}
              >
                Copy
              </button>
            </div>
            <p className="mt-1 break-all text-[11px] text-text-3">{uri}</p>
            <p className="mt-4 text-[13px] text-text-2">2. Enter the 6-digit code it shows:</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className={cx(FIELD, 'w-32 font-mono tracking-[0.3em]')}
              />
              <Button variant="primary" size="sm" onClick={() => void verify()} disabled={verifying || code.trim().length < 6}>
                {verifying ? 'Verifying…' : 'Verify & enable'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSecret(null);
                  setUri('');
                  setCode('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {auth.enabled && (
        <div className="mt-8 border-t border-line pt-5">
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      )}
    </section>
  );
}
