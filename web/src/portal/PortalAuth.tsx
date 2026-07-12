import { useState } from 'react';
import { useNavigate } from 'react-router';
import { usePortal } from './store';
import { Button } from '../components/Button';
import { cx } from '../components/util';
import { IconLogo } from '../icons';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-bg px-3 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

type Mode = 'login' | 'register';

export function PortalAuth() {
  const login = usePortal((s) => s.login);
  const register = usePortal((s) => s.register);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    password.length >= 8 &&
    (mode === 'login' || name.trim() !== '');

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login({ email: email.trim(), password });
      else await register({ name: name.trim(), email: email.trim(), password });
      navigate('/portal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <IconLogo size={32} />
          <h1 className="mt-3 text-[20px] font-semibold">Support Center</h1>
          <p className="mt-1 text-[13px] text-text-3">
            {mode === 'login' ? 'Sign in to see your tickets' : 'Create an account to get help'}
          </p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-5 shadow-1">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cx(
                  'h-8 rounded-[6px] text-[13px] font-medium transition-colors',
                  mode === m ? 'bg-surface text-text shadow-1' : 'text-text-2 hover:text-text',
                )}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === 'register' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={FIELD} autoComplete="name" />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={FIELD} autoComplete="email" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
                className={FIELD}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </label>

            {error !== null && (
              <div className="rounded-md border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">{error}</div>
            )}

            <Button variant="primary" size="md" disabled={!valid || busy} onClick={() => void submit()}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[12px] text-text-3">
          Your password is stored hashed on this self-hosted server. For a production deployment, add
          email verification (magic links) before going live.
        </p>
      </div>
    </div>
  );
}
