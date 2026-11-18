import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError, errorText, fmtDate, type Me } from '../../api/client.ts';
import { PasswordInput } from '../../components/PasswordInput.tsx';
import { waitText } from '../Auth.tsx';

/** "Delete account": the password confirms it; afterwards the visitor is signed out and sent home. */
export function DeleteAccountCard({ me, onDeleted }: { me: Me; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const paidUntil = me.plan.expiresAt && new Date(me.plan.expiresAt) > new Date() ? me.plan.expiresAt : null;
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: onDeleted,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 429 && err.retryAfter) setError(`Too many wrong passwords. Try again ${waitText(err.retryAfter)}.`);
      else setError(err instanceof ApiError && err.fields?.password ? err.fields.password : errorText(err));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    remove.mutate();
  };
  return (
    <section className="card" aria-labelledby="delete-account-title" style={{ marginTop: 20 }}>
      <h2 id="delete-account-title" style={{ margin: '0 0 8px' }}>Delete account</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Permanently deletes your login and every team where you are the only member, with its API keys and usage
        history. Apps using those keys stop working at once. Teams with other members stay; if you are their only
        owner, make someone else an owner first. This cannot be undone. Payment records are kept for tax purposes,
        without your name or email.
        See the <Link to="/privacy">privacy policy</Link>.
      </p>
      {!open ? (
        <button className="btn btn-danger btn-sm" type="button" onClick={() => setOpen(true)}>Delete my account…</button>
      ) : (
        <form onSubmit={submit} noValidate>
          {paidUntil ? <p className="form-error">Your {me.plan.name} plan is paid until {fmtDate(paidUntil)}. Deleting the account ends it with no refund.</p> : null}
          <div className="field">
            <label htmlFor="delete-password">Enter your password to confirm</label>
            <PasswordInput
              id="delete-password" className="input" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'delete-error' : undefined}
            />
          </div>
          <p id="delete-error" className="form-error" role="alert" hidden={!error}>{error}</p>
          <div className="row">
            <button className="btn btn-danger btn-sm" type="submit" disabled={!password || remove.isPending}>{remove.isPending ? 'Deleting…' : 'Delete my account permanently'}</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setOpen(false); setPassword(''); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
