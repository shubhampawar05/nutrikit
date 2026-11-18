// /invite?token=…: what a team invitation offers, and accepting it. Someone without a login signs up (or logs in)
// first and comes back here; the invitation only works for the email it was sent to.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, fmtDate } from '../api/client.ts';
import { forgetAccount, useMe, useTeamChanged } from '../hooks.ts';
import { AuthCard as Card } from '../components/AuthCard.tsx';
import { authPath } from './Auth.tsx';
import { ROLE_NAMES } from './dashboard/Team.tsx';

export function Invite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const teamChanged = useTeamChanged();
  const [error, setError] = useState('');
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.invitation(token),
    enabled: Boolean(token),
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });
  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token),
    onSuccess: (view) => {
      teamChanged(view);
      navigate('/dashboard');
    },
    onError: (err) => setError(errorText(err)),
  });
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => forgetAccount(queryClient),
  });

  if (!token || (invitation.isError && invitation.error instanceof ApiError && invitation.error.status < 500)) {
    return (
      <Card title="This invitation doesn't work">
        <p className="muted">It has expired, was revoked or was already used. Ask the person who invited you to send a new one.</p>
        <p className="small"><Link to="/dashboard">Go to your dashboard</Link></p>
      </Card>
    );
  }
  if (invitation.isError) {
    return (
      <Card title="Team invitation">
        <p className="form-error" role="alert">{errorText(invitation.error)}</p>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => invitation.refetch()}>Retry</button>
      </Card>
    );
  }
  // Couldn't tell whether anyone is signed in: don't ask a signed-in person to sign up.
  if (me.isError) {
    return (
      <Card title="Team invitation">
        <p className="form-error" role="alert">{errorText(me.error)}</p>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => me.refetch()}>Retry</button>
      </Card>
    );
  }
  if (invitation.isPending || me.isPending) return <Card title="Team invitation"><p className="muted" role="status">Loading the invitation…</p></Card>;

  const inv = invitation.data;
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const signedIn = me.data;
  const matches = signedIn && signedIn.user.email.toLowerCase() === inv.email.toLowerCase();
  const role = ROLE_NAMES[inv.role].toLowerCase();

  return (
    <Card title={`Join ${inv.team}`}>
      <p className="muted">
        <b>{inv.invitedBy ?? 'A team owner'}</b> invited you to join <b>{inv.team}</b> on Nutrikit as {role === 'admin' ? 'an' : 'a'} <b>{role}</b>.
      </p>
      <p className="small muted">For <b>{inv.email}</b> · works until {fmtDate(inv.expiresAt)}.</p>
      <p className="form-error" role="alert" hidden={!error}>{error}</p>
      {!signedIn ? (
        <>
          <p className="small">Sign up or log in with <b>{inv.email}</b> to accept.</p>
          <div className="row">
            <Link className="btn btn-primary" to={authPath('/signup', here, inv.email)}>Create an account</Link>
            <Link className="btn btn-ghost" to={authPath('/login', here, inv.email)}>Log in</Link>
          </div>
        </>
      ) : matches ? (
        <button className="btn btn-primary" type="button" disabled={accept.isPending} onClick={() => { setError(''); accept.mutate(); }}>
          {accept.isPending ? 'Joining…' : `Join ${inv.team}`}
        </button>
      ) : (
        <>
          <p className="small">
            You're signed in as <b>{signedIn.user.email}</b>, but this invitation is for <b>{inv.email}</b>. Log out and sign in with that email to accept it.
          </p>
          <button className="btn btn-ghost" type="button" disabled={logout.isPending} onClick={() => logout.mutate()}>Log out</button>
        </>
      )}
    </Card>
  );
}
