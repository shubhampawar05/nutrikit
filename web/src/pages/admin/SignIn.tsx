import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { adminApi, adminToken } from '../../api/admin.ts';
import { PasswordInput } from '../../components/PasswordInput.tsx';
import { message } from './common.tsx';

export function SignIn({ onSignedIn, notice = '' }: { onSignedIn: () => void; notice?: string }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi.signIn(token.trim());
      adminToken.set(token.trim());
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'That admin token was not accepted.' : message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="wrap">
      <form className="card admin-signin" onSubmit={submit}>
        <span className="kicker">Admin</span>
        <h1 style={{ margin: '8px 0 6px' }}>Operator console</h1>
        <p className="muted small" style={{ marginTop: 0 }}>Sign in with the server's <code>NUTRIKIT_ADMIN_TOKEN</code>. It is kept in this tab only.</p>
        <div className="field">
          <label htmlFor="admin-token">Admin token</label>
          <PasswordInput noun="token" id="admin-token" className="input" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !token.trim()} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
