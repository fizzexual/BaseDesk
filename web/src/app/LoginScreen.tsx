import { useState, type FormEvent } from 'react';
import { useApp } from '../data/store';
import { IconLogo } from '../icons';

const FIELD = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

/** Shown by the boot gate when the server requires login and we have no session. */
export function LoginScreen() {
  const login = useApp((s) => s.login);
  const productName = useApp((s) => s.branding.productName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, needs2fa ? code.trim() : undefined);
      // On success the store re-boots and unmounts this screen.
    } catch (err) {
      if ((err as { needs2fa?: boolean }).needs2fa === true) setNeeds2fa(true);
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-1">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <IconLogo size={20} />
          </span>
          <div>
            <div className="text-[15px] font-semibold">{productName}</div>
            <div className="text-[12px] text-text-3">Sign in to continue</div>
          </div>
        </div>

        <label htmlFor="login-email" className="mb-1 block text-[13px] font-medium text-text-2">Email</label>
        <input id="login-email" type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} placeholder="you@company.com" />

        <label htmlFor="login-password" className="mb-1 mt-3 block text-[13px] font-medium text-text-2">Password</label>
        <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} placeholder="Your password" />

        {needs2fa && (
          <>
            <label htmlFor="login-code" className="mb-1 mt-3 block text-[13px] font-medium text-text-2">Two-factor code</label>
            <input id="login-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className={FIELD} placeholder="6-digit code" />
          </>
        )}

        {error !== null && <p className="mt-3 text-[13px] text-red">{error}</p>}

        <button
          type="submit"
          disabled={busy || email.trim() === '' || password === ''}
          className="mt-5 h-9 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
