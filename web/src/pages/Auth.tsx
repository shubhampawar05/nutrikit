// Sign up / log in: one form for both pages (the legacy portal.js auth half).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText } from '../api/client.ts';
import { useMe } from '../hooks.ts';

type Mode = 'signup' | 'login';
interface AuthFields { name: string; email: string; password: string }
const FIELD_ORDER: (keyof AuthFields)[] = ['name', 'email', 'password'];
const PASSWORD_RULE = 'At least 10 characters.';
const LOG_IN_INSTEAD = 'log in instead';

/** Where to go after signing in: `?next=` when it is a same-site path, else the dashboard. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

const isField = (name: string): name is keyof AuthFields => (FIELD_ORDER as string[]).includes(name);

/** "in about 15 minutes" from a Retry-After in seconds. */
export function waitText(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return 'later';
  if (seconds < 90) return 'in a minute';
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90 ? `in about ${minutes} minutes` : `in about ${Math.round(minutes / 60)} hours`;
}

/** An auth page path that keeps the visitor's `?next=` (and, for login, the email they typed). */
export function authPath(path: '/login' | '/signup', next: string | null, email?: string): string {
  const q = new URLSearchParams();
  if (email) q.set('email', email);
  if (next) q.set('next', next);
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

// The server's throttles (per network and per email), worded for the form.
const THROTTLED: Record<string, string> = {
  too_many_signups: 'Too many accounts were created from your network recently. Please try again',
  too_many_attempts: 'Too many failed logins. Please try again',
};

function AuthForm({ mode }: { mode: Mode }) {
  const isLogin = mode === 'login';
  const [params] = useSearchParams();
  const next = params.get('next');
  const target = safeNext(next);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const submitted = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, setError, clearErrors, setFocus, getValues, formState: { errors, isSubmitting } } = useForm<AuthFields>({
    // "log in instead" links here with the email filled in.
    defaultValues: { name: '', email: params.get('email') ?? '', password: '' },
  });

  // Already signed in? Go straight to the target.
  useEffect(() => {
    if (me.data && !submitted.current) navigate(target, { replace: true });
  }, [me.data, navigate, target]);

  const onSubmit = async (data: AuthFields) => {
    setFormError(null);
    clearErrors();
    try {
      if (isLogin) {
        await api.login({ email: data.email, password: data.password });
      } else {
        const res = await api.signup(data);
        // The first key is shown once on the dashboard, then forgotten.
        if (res.firstKey) sessionStorage.setItem('nutrikit-new-key', JSON.stringify(res.firstKey));
      }
      submitted.current = true;
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(target);
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : undefined;
      if (err instanceof ApiError && THROTTLED[err.code]) {
        setFormError(`${THROTTLED[err.code]} ${waitText(err.retryAfter)}.`);
      } else if (fields) {
        const shown = FIELD_ORDER.filter((name) => fields[name] && (name !== 'name' || !isLogin));
        for (const [name, msg] of Object.entries(fields)) {
          if (isField(name) && shown.includes(name)) setError(name, { type: 'server', message: msg });
        }
        if (shown[0]) setFocus(shown[0]);
      } else {
        setFormError(errorText(err));
      }
    }
  };

  // A field's error clears as soon as the user edits it. The input points at its error (or, for the signup
  // password, at the rule) so screen readers announce it with the field.
  const showRule = !isLogin && !errors.password;
  const fieldProps = (name: keyof AuthFields) => ({
    ...register(name, { onChange: () => clearErrors(name) }),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : name === 'password' && showRule ? 'password-rule' : undefined,
  });
  const fieldClass = (name: keyof AuthFields) => (errors[name] ? 'field invalid' : 'field');

  // "This email is already registered — log in instead." links to login with the email filled in.
  const errorContent = (name: keyof AuthFields): ReactNode => {
    const msg = errors[name]?.message;
    const at = msg?.indexOf(LOG_IN_INSTEAD) ?? -1;
    if (!msg || name !== 'email' || at < 0) return msg;
    return <>{msg.slice(0, at)}<Link to={authPath('/login', next, getValues('email'))}>{LOG_IN_INSTEAD}</Link>{msg.slice(at + LOG_IN_INSTEAD.length)}</>;
  };

  return (
    <main className="auth-shell">
      <aside className="auth-aside" aria-hidden="true">
        <div>
          <span className="kicker" style={{ color: 'var(--butter)' }}>Nutrikit</span>
          <h2>From “a bowl of oatmeal” to <em>numbers you can trust</em>.</h2>
          <p>Your first key works the moment you sign up — 2,000 free tokens every month.</p>
        </div>
        <div className="nf">
          <p className="nf-title">Nutrition Facts</p>
          <div className="nf-sub">2 foods · a bowl of oatmeal and a coffee</div>
          <div className="nf-cal"><b>Calories</b><span>180</span></div>
          <div className="nf-dv">% Daily Value*</div>
          <div className="nf-row"><span><b>Total Fat</b> 6g</span><b>8%</b></div>
          <div className="nf-row"><span><b>Sodium</b> 200mg</span><b>9%</b></div>
          <div className="nf-row"><span><b>Total Carbohydrate</b> 27g</span><b>10%</b></div>
          <div className="nf-row sub"><span>Dietary Fiber 4g</span><b>15%</b></div>
          <div className="nf-row thick"><span><b>Protein</b> 6g</span><b>11%</b></div>
          <p className="nf-note">* % Daily Value is based on a 2,000 calorie diet.</p>
        </div>
      </aside>
      <div className="auth-main">
        <div className="auth-card">
          <h1>{isLogin ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">{isLogin ? 'Log in to manage your keys and usage.' : 'Free plan · 2,000 tokens a month · your API key in seconds.'}</p>
          <div className="form-error" role="alert" hidden={!formError}>{formError}</div>
          <form noValidate onSubmit={handleSubmit(onSubmit)}>
            {!isLogin && (
              <div className={fieldClass('name')}>
                <label htmlFor="name">Name or company</label>
                <input id="name" autoComplete="organization" required {...fieldProps('name')} />
                <div className="error" id="name-error">{errorContent('name')}</div>
              </div>
            )}
            <div className={fieldClass('email')}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required {...fieldProps('email')} />
              <div className="error" id="email-error">{errorContent('email')}</div>
            </div>
            <div className={fieldClass('password')}>
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} minLength={10} required {...fieldProps('password')} />
              <div className="error" id="password-error">{errorContent('password')}</div>
              {showRule && <span className="small muted" id="password-rule">{PASSWORD_RULE}</span>}
            </div>
            <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={isSubmitting}>
              {isLogin ? 'Log in' : 'Create account'}
            </button>
          </form>
          <p className="small muted" style={{ margin: '16px 0 0', textAlign: 'center' }}>
            {isLogin
              ? <>New to Nutrikit? <Link to={authPath('/signup', next)}>Create an account</Link></>
              : <>Already have an account? <Link to={authPath('/login', next)}>Log in</Link></>}
          </p>
        </div>
      </div>
    </main>
  );
}

export function Signup() {
  return <AuthForm key="signup" mode="signup" />;
}

export function Login() {
  return <AuthForm key="login" mode="login" />;
}
