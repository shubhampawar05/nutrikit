import { useState } from 'react';
import { api, ApiError, errorText } from '../../api/client.ts';
import { waitText } from '../Auth.tsx';

// Unverified address: the API keeps working; this asks once per visit and can send the link again.
export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'sent' } | { kind: 'error'; text: string }>({ kind: 'idle' });
  const send = async () => {
    setState({ kind: 'sending' });
    try {
      await api.sendVerification();
      setState({ kind: 'sent' });
    } catch (err) {
      setState({ kind: 'error', text: err instanceof ApiError && err.code === 'too_many_emails' ? `A link was sent recently. Check your inbox, or try again ${waitText(err.retryAfter)}.` : errorText(err) });
    }
  };
  return (
    <div className="notice" role="status">
      <b>Confirm your email.</b> We sent a link to <b>{email}</b> so you can recover your account if you forget your password.{' '}
      {state.kind === 'sent' ? <span>A new link is on its way.</span>
        : <button type="button" className="btn btn-ghost btn-sm" onClick={send} disabled={state.kind === 'sending'}>Send a new link</button>}
      {state.kind === 'error' ? <span role="alert"> {state.text}</span> : null}
    </div>
  );
}
