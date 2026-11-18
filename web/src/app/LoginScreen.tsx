import { useEffect, useState, type FormEvent } from 'react';
import { acceptInvite, claimSetup, fetchSetupNeeded } from '../data/api';
import { useApp } from '../data/store';
import { IconLogo } from '../icons';

const FIELD = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

/** Shown by the boot gate when the server requires login and we have no session. */
export function LoginScreen() {
  const [setup, setSetup] = useState<boolean | null>(null);
  useEffect(() => {
    void fetchSetupNeeded().then(setSetup);
  }, []);
  if (setup === null) return <div className="h-full bg-bg" />;
  return setup ? <SetupForm /> : <SignInForm />;
}

/**
 * First run of a production server: claim the admin account. The setup token is printed
 * in the server log, so only the person running the server can do this.
 */
function SetupForm() {
  const init = useApp((s) => s.init);
  const productName = useApp((s) => s.branding.productName);
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await claimSetup({ token: token.trim(), name: name.trim(), email: email.trim(), password });
      await init(); // signed in: re-bootstrap and leave this screen
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
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
            <div className="text-[15px] font-semibold">Set up {productName}</div>
            <div className="text-[12px] text-text-3">Create the admin account</div>
          </div>
        </div>

        <label htmlFor="setup-token" className="mb-1 block text-[13px] font-medium text-text-2">Setup token</label>
        <input id="setup-token" autoFocus autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} className={`${FIELD} font-mono`} placeholder="From the server log" />
        <p className="mt-1 text-[12px] text-text-3">The server printed it when it started.</p>

        <label htmlFor="setup-name" className="mb-1 mt-3 block text-[13px] font-medium text-text-2">Your name</label>
        <input id="setup-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={FIELD} placeholder="Jane Doe" />

        <label htmlFor="setup-email" className="mb-1 mt-3 block text-[13px] font-medium text-text-2">Email</label>
        <input id="setup-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} placeholder="you@company.com" />

        <label htmlFor="setup-password" className="mb-1 mt-3 block text-[13px] font-medium text-text-2">Password</label>
        <input id="setup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} placeholder="At least 8 characters" />

        {error !== null && <p className="mt-3 text-[13px] text-red">{error}</p>}

        <button
          type="submit"
          disabled={busy || token.trim() === '' || name.trim() === '' || email.trim() === '' || password.length < 8}
          className="mt-5 h-9 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </div>
  );
}

function SignInForm() {
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

/** Opened from an /invite/<token> link: the teammate picks their password and is in. */
export function AcceptInviteScreen({ token }: { token: string }) {
  const productName = useApp((s) => s.branding.productName);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(token, password);
      window.location.replace('/'); // a fresh boot as the new teammate
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invite');
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
            <div className="text-[15px] font-semibold">Join {productName}</div>
            <div className="text-[12px] text-text-3">Pick a password to accept your invite</div>
          </div>
        </div>

        <label htmlFor="invite-password" className="mb-1 block text-[13px] font-medium text-text-2">Password</label>
        <input id="invite-password" type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} placeholder="At least 8 characters" />

        {error !== null && <p className="mt-3 text-[13px] text-red">{error}</p>}

        <button
          type="submit"
          disabled={busy || password.length < 8}
          className="mt-5 h-9 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Joining…' : 'Accept invite'}
        </button>
      </form>
    </div>
  );
}
