import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderPage } from '../test-utils.tsx';
import { Login, Signup, authPath, safeNext } from './Auth.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = {
  account: { id: 'acc_1', name: 'Ada', email: 'ada@example.com', createdAt: '2026-10-01T00:00:00Z' },
  plan: { id: 'free', name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, expiresAt: null },
  usage: { periodStart: '2026-10-01T00:00:00Z', used: 0, remaining: 2000 },
  plans: {},
  billing: { enabled: false, mode: null, currency: 'INR', keyId: null },
};

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function app(path: string) {
  return renderPage(
    <Routes>
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path },
  );
}

/** A fetch stub: /me is signed out until a successful login/signup, then signed in. */
function stubPortal(onAuth: (path: string, body: Record<string, string>) => Response) {
  let signedIn = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/portal/api/me')) return signedIn ? json(200, me) : json(401, { error: { code: 'unauthorized', message: 'not signed in' } });
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
    const res = onAuth(url.replace('/portal/api', ''), body);
    if (res.ok) signedIn = true;
    return res;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('safeNext', () => {
  it('only accepts same-site paths', () => {
    expect(safeNext('/docs')).toBe('/docs');
    expect(safeNext('//evil.example')).toBe('/dashboard');
    expect(safeNext('https://evil.example')).toBe('/dashboard');
    expect(safeNext(null)).toBe('/dashboard');
  });
});

describe('authPath', () => {
  it('keeps next and the email in the query', () => {
    expect(authPath('/signup', null)).toBe('/signup');
    expect(authPath('/signup', '/playground')).toBe('/signup?next=%2Fplayground');
    expect(authPath('/login', '/docs', 'ada@example.com')).toBe('/login?email=ada%40example.com&next=%2Fdocs');
  });
});

describe('Signup', () => {
  it('renders the signup copy and fields', () => {
    stubPortal(() => json(500, {}));
    app('/signup');
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeTruthy();
    expect(screen.getByLabelText('Name or company')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText('At least 10 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toBe('password-rule');
    // Show/hide: the button flips the field between hidden and plain text, and says which it will do next.
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'terms of use' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe('/privacy');
  });

  it('links "log in instead" to login with the email filled in, keeping next', async () => {
    stubPortal(() => json(409, { error: { code: 'email_taken', message: 'an account with this email already exists', fields: { email: 'This email is already registered — log in instead.' } } }));
    app('/signup?next=/playground');
    fireEvent.change(screen.getByLabelText('Name or company'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const link = await screen.findByRole('link', { name: 'log in instead' });
    expect(link.closest('.error')?.textContent).toBe('This email is already registered — log in instead.');
    expect(link.getAttribute('href')).toBe('/login?email=ada%40example.com&next=%2Fplayground');
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ada@example.com');
  });

  it('checks the confirm password before sending, and never sends it', async () => {
    const fetchMock = stubPortal(() => json(500, {}));
    app('/signup');
    fireEvent.change(screen.getByLabelText('Name or company'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct horse batery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText("Passwords don't match.")).toBeTruthy();
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-invalid')).toBe('true');
    const signups = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/signup'));
    expect(signups()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct horse battery' } });
    expect(screen.queryByText("Passwords don't match.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(signups()).toHaveLength(1));
    expect(JSON.parse(String(signups()[0]![1]?.body))).toEqual({ name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' });
  });

  it('has no confirm field on login', () => {
    stubPortal(() => json(500, {}));
    app('/login');
    expect(screen.queryByLabelText('Confirm password')).toBeNull();
  });

  it('keeps ?next= on the "Log in" link', () => {
    stubPortal(() => json(500, {}));
    app('/signup?next=/playground');
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login?next=%2Fplayground');
  });

  it('shows server field errors under the right inputs and clears them on edit', async () => {
    const fetchMock = stubPortal(() =>
      json(400, { error: { code: 'invalid_request', message: 'check the form', fields: { email: 'enter a valid email', password: 'use at least 10 characters' } } }),
    );
    app('/signup');
    fireEvent.change(screen.getByLabelText('Name or company'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const emailError = await screen.findByText('enter a valid email');
    const emailField = screen.getByLabelText('Email').closest('.field');
    expect(emailField?.contains(emailError)).toBe(true);
    expect(emailField?.classList.contains('invalid')).toBe(true);
    const pwField = screen.getByLabelText('Password').closest('.field');
    expect(pwField?.textContent).toContain('use at least 10 characters');
    // The rule is shown once: as the error, not also as the hint.
    expect(screen.queryByText('At least 10 characters.')).toBeNull();
    // Each invalid input points at its error text.
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent).toBe('enter a valid email');
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(password.getAttribute('aria-describedby')!)?.textContent).toBe('use at least 10 characters');
    expect(screen.getByLabelText('Name or company').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Name or company').closest('.field')?.classList.contains('invalid')).toBe(false);
    expect((document.querySelector('.form-error') as HTMLElement).hidden).toBe(true);

    const signupCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/signup'));
    expect(JSON.parse(String(signupCall?.[1]?.body))).toEqual({ name: 'Ada', email: 'nope', password: 'short' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    await waitFor(() => expect(screen.queryByText('enter a valid email')).toBeNull());
    expect(emailField?.classList.contains('invalid')).toBe(false);
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBeNull();
    // Only the edited field clears.
    expect(pwField?.classList.contains('invalid')).toBe(true);
  });

  it('shows other errors in the form error box, capitalised with a full stop', async () => {
    stubPortal(() => json(409, { error: { code: 'email_taken', message: 'an account with that email already exists' } }));
    app('/signup');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByText('An account with that email already exists.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect((alert as HTMLElement).hidden).toBe(false);
  });

  it('explains a signup throttle with the wait from Retry-After', async () => {
    stubPortal(() => new Response(JSON.stringify({ error: { code: 'too_many_signups', message: 'too many signups from your network; try again later' } }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '1500' },
    }));
    app('/signup');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toBe('Too many accounts were created from your network recently. Please try again in about 25 minutes.'));
  });

  it('explains a login throttle', async () => {
    stubPortal(() => new Response(JSON.stringify({ error: { code: 'too_many_attempts', message: 'too many failed logins; try again in 15 minutes' } }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
    }));
    app('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toBe('Too many failed logins. Please try again in about 15 minutes.'));
  });

  it('stashes the first key for the dashboard and goes there', async () => {
    stubPortal(() => json(201, { ...me, firstKey: { id: 'key_1', name: 'Default', key: 'nk_live_secret' } }));
    app('/signup');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/dashboard');
    expect(JSON.parse(sessionStorage.getItem('nutrikit-new-key') ?? '{}').key).toBe('nk_live_secret');
  });
});

describe('Login', () => {
  it('uses the login copy and hides signup-only fields', () => {
    stubPortal(() => json(500, {}));
    app('/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(screen.queryByLabelText('Name or company')).toBeNull();
    expect(screen.queryByText('At least 10 characters.')).toBeNull();
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signup');
  });

  it('redirects to a safe ?next= path after logging in', async () => {
    const fetchMock = stubPortal(() => json(200, me));
    app('/login?next=/docs/reference');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/docs/reference');
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/login'));
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ email: 'ada@example.com', password: 'correct horse' });
  });

  it.each(['//evil.example/x', 'https://evil.example/x', 'dashboard'])('ignores an unsafe ?next=%s', async (next) => {
    stubPortal(() => json(200, me));
    app(`/login?next=${encodeURIComponent(next)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/dashboard');
  });

  it('disables the button while submitting', async () => {
    let finish: (r: Response) => void = () => {};
    stubPortal(() => json(200, me));
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/login') ? new Promise<Response>((r) => { finish = r; }) : original(input, init)));
    app('/login');
    const button = screen.getByRole('button', { name: 'Log in' });
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    finish(json(401, { error: { code: 'invalid_credentials', message: 'wrong email or password' } }));
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps ?next= through "Create an account" and lands there after signing up', async () => {
    stubPortal(() => json(201, { ...me, firstKey: { id: 'key_1', name: 'Default', key: 'nk_live_secret' } }));
    app('/login?next=/playground');
    const link = screen.getByRole('link', { name: 'Create an account' });
    expect(link.getAttribute('href')).toBe('/signup?next=%2Fplayground');
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Create your account' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/playground');
  });

  it('prefills the email from ?email=', () => {
    stubPortal(() => json(500, {}));
    app('/login?email=ada%40example.com');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ada@example.com');
  });

  it('sends an already signed-in visitor straight to the target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, me)));
    app('/login?next=/playground');
    expect((await screen.findByTestId('where')).textContent).toBe('/playground');
  });
});
