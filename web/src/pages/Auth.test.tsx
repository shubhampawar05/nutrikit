import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderPage } from '../test-utils.tsx';
import { Login, Signup, safeNext } from './Auth.tsx';

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

describe('Signup', () => {
  it('renders the signup copy and fields', () => {
    stubPortal(() => json(500, {}));
    app('/signup');
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeTruthy();
    expect(screen.getByLabelText('Name or company')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText('At least 10 characters.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
  });

  it('shows server field errors under the right inputs and clears them on edit', async () => {
    const fetchMock = stubPortal(() =>
      json(400, { error: { code: 'invalid_request', message: 'check the form', fields: { email: 'enter a valid email', password: 'use at least 10 characters' } } }),
    );
    app('/signup');
    fireEvent.change(screen.getByLabelText('Name or company'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const emailError = await screen.findByText('enter a valid email');
    const emailField = screen.getByLabelText('Email').closest('.field');
    expect(emailField?.contains(emailError)).toBe(true);
    expect(emailField?.classList.contains('invalid')).toBe(true);
    const pwField = screen.getByLabelText('Password').closest('.field');
    expect(pwField?.textContent).toContain('use at least 10 characters');
    expect(screen.getByLabelText('Name or company').closest('.field')?.classList.contains('invalid')).toBe(false);
    expect((document.querySelector('.form-error') as HTMLElement).hidden).toBe(true);

    const signupCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/signup'));
    expect(JSON.parse(String(signupCall?.[1]?.body))).toEqual({ name: 'Ada', email: 'nope', password: 'short' });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    await waitFor(() => expect(screen.queryByText('enter a valid email')).toBeNull());
    expect(emailField?.classList.contains('invalid')).toBe(false);
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

  it('sends an already signed-in visitor straight to the target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, me)));
    app('/login?next=/playground');
    expect((await screen.findByTestId('where')).textContent).toBe('/playground');
  });
});
