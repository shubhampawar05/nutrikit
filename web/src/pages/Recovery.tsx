// Account recovery: ask for a password-reset link, set a new password from it, and confirm an email address.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText } from '../api/client.ts';
import { PASSWORD_RULE, safeNext, waitText } from './Auth.tsx';

function Card({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth-shell single">
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          {lead ? <p className="muted">{lead}</p> : null}
          {children}
        </div>
      </div>
    </main>
  );
}

const BAD_LINK = 'This link has expired or was already used.';

export function ForgotPassword() {
  const [params] = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<{ email: string }>({
    defaultValues: { email: params.get('email') ?? '' },
  });

  const onSubmit = async ({ email }: { email: string }) => {
    setFormError(null);
    try {
      await api.forgotPassword(email);
      setSentTo(email);
    } catch (err) {
      if (err instanceof ApiError && err.fields?.email) setError('email', { type: 'server', message: err.fields.email });
      else if (err instanceof ApiError && err.code === 'too_many_emails') setFormError(`Too many emails were requested from your network. Please try again ${waitText(err.retryAfter)}.`);
      else setFormError(errorText(err));
    }
  };

  if (sentTo) {
    return (
      <Card title="Check your email" lead={<>If an account uses <b>{sentTo}</b>, we've sent it a link to choose a new password. The link works once, for 1 hour.</>}>
        <p className="small muted">No email after a few minutes? Check your spam folder, or send it again.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSentTo(null)}>Send again</button>
        <p className="small"><Link to="/login">Back to log in</Link></p>
      </Card>
    );
  }

  return (
    <Card title="Reset your password" lead="Enter your account's email and we'll send you a link to choose a new password.">
      <div className="form-error" role="alert" hidden={!formError}>{formError}</div>
      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <div className={errors.email ? 'field invalid' : 'field'}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined} {...register('email', { onChange: () => clearErrors('email') })} />
          <div className="error" id="email-error">{errors.email?.message}</div>
        </div>
        <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={isSubmitting}>Send reset link</button>
      </form>
      <p className="small muted" style={{ margin: '16px 0 0', textAlign: 'center' }}>Remembered it? <Link to="/login">Log in</Link></p>
    </Card>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<ReactNode>(null);
  const { register, handleSubmit, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<{ password: string }>({ defaultValues: { password: '' } });

  const onSubmit = async ({ password }: { password: string }) => {
    setFormError(null);
    try {
      await api.resetPassword(token, password);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(safeNext(null));
    } catch (err) {
      if (err instanceof ApiError && err.fields?.password) setError('password', { type: 'server', message: err.fields.password });
      else if (err instanceof ApiError && err.code === 'invalid_token') setFormError(<>{BAD_LINK} <Link to="/forgot-password">Get a new link</Link>.</>);
      else setFormError(errorText(err));
    }
  };

  if (!token) {
    return <Card title="Choose a new password" lead={<>{BAD_LINK} <Link to="/forgot-password">Get a new link</Link>.</>}>{null}</Card>;
  }

  return (
    <Card title="Choose a new password" lead="You'll be signed in, and signed out everywhere else.">
      <div className="form-error" role="alert" hidden={!formError}>{formError}</div>
      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <div className={errors.password ? 'field invalid' : 'field'}>
          <label htmlFor="password">New password</label>
          <input id="password" type="password" autoComplete="new-password" minLength={10} required aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'password-error' : 'password-rule'} {...register('password', { onChange: () => clearErrors('password') })} />
          <div className="error" id="password-error">{errors.password?.message}</div>
          {!errors.password && <span className="small muted" id="password-rule">{PASSWORD_RULE}</span>}
        </div>
        <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={isSubmitting}>Set password and log in</button>
      </form>
    </Card>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'done'; email: string } | { kind: 'failed'; text: string }>(
    token ? { kind: 'working' } : { kind: 'failed', text: BAD_LINK },
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.verifyEmail(token)
      .then(async ({ email }) => {
        setState({ kind: 'done', email });
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((err) => setState({ kind: 'failed', text: err instanceof ApiError && err.code === 'invalid_token' ? BAD_LINK : errorText(err) }));
  }, [token, queryClient]);

  if (state.kind === 'working') return <Card title="Confirming your email…">{<p className="muted" role="status">One moment.</p>}</Card>;
  if (state.kind === 'done') {
    return (
      <Card title="Email confirmed" lead={<><b>{state.email}</b> is confirmed. Thanks!</>}>
        <Link className="btn btn-primary" to="/dashboard">Go to your dashboard</Link>
      </Card>
    );
  }
  return (
    <Card title="We couldn't confirm your email" lead={state.text}>
      <p className="small muted">Log in and use <b>Send a new link</b> on your dashboard.</p>
      <Link className="btn btn-primary" to="/dashboard">Go to your dashboard</Link>
    </Card>
  );
}
