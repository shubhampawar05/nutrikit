// Sign up / log in: one form for both pages (the legacy portal.js auth half).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client.ts';
import { useMe } from '../hooks.ts';

type Mode = 'signup' | 'login';
interface AuthFields { name: string; email: string; password: string }
const FIELD_ORDER: (keyof AuthFields)[] = ['name', 'email', 'password'];

/** Where to go after signing in: `?next=` when it is a same-site path, else the dashboard. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

const isField = (name: string): name is keyof AuthFields => (FIELD_ORDER as string[]).includes(name);

function AuthForm({ mode }: { mode: Mode }) {
  const isLogin = mode === 'login';
  const [params] = useSearchParams();
  const target = safeNext(params.get('next'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const submitted = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, setError, clearErrors, setFocus, formState: { errors, isSubmitting } } = useForm<AuthFields>({
    defaultValues: { name: '', email: '', password: '' },
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
      const message = err instanceof Error ? err.message : 'Something went wrong';
      const fields = err instanceof ApiError ? err.fields : undefined;
      if (fields) {
        const shown = FIELD_ORDER.filter((name) => fields[name] && (name !== 'name' || !isLogin));
        for (const [name, msg] of Object.entries(fields)) {
          if (isField(name) && shown.includes(name)) setError(name, { type: 'server', message: msg });
        }
        if (shown[0]) setFocus(shown[0]);
      } else {
        setFormError(message.charAt(0).toUpperCase() + message.slice(1) + '.');
      }
    }
  };

  // A field's error clears as soon as the user edits it.
  const field = (name: keyof AuthFields) => register(name, { onChange: () => clearErrors(name) });
  const fieldClass = (name: keyof AuthFields) => (errors[name] ? 'field invalid' : 'field');

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
                <input id="name" autoComplete="organization" required {...field('name')} />
                <div className="error">{errors.name?.message}</div>
              </div>
            )}
            <div className={fieldClass('email')}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required {...field('email')} />
              <div className="error">{errors.email?.message}</div>
            </div>
            <div className={fieldClass('password')}>
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} minLength={10} required {...field('password')} />
              <div className="error">{errors.password?.message}</div>
              {!isLogin && <span className="small muted">At least 10 characters.</span>}
            </div>
            <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={isSubmitting}>
              {isLogin ? 'Log in' : 'Create account'}
            </button>
          </form>
          <p className="small muted" style={{ margin: '16px 0 0', textAlign: 'center' }}>
            {isLogin
              ? <>New to Nutrikit? <Link to="/signup">Create an account</Link></>
              : <>Already have an account? <Link to="/login">Log in</Link></>}
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
