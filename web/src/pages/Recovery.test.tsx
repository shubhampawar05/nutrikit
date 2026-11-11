import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderPage } from '../test-utils.tsx';
import { ForgotPassword, ResetPassword, VerifyEmail } from './Recovery.tsx';
import { Login } from './Auth.tsx';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { error: { code, message: code, ...extra } });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function app(path: string) {
  return renderPage(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path },
  );
}

/** Stub fetch: `/me` is signed out; `routes` answers the other portal calls by path. */
function stub(routes: Record<string, (body: Record<string, string>) => Response>) {
  const calls: { path: string; body: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/portal/api', '');
    if (path === '/me') return fail(401, 'unauthorized');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
    calls.push({ path, body });
    return routes[path]?.(body) ?? fail(404, 'not_found');
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('account recovery', () => {
  it('links from login to the reset form, keeping the email typed', async () => {
    stub({});
    app('/login?email=ada%40example.com');
    const link = await screen.findByRole('link', { name: 'Forgot password?' });
    expect(link.getAttribute('href')).toBe('/forgot-password?email=ada%40example.com');
  });

  it('asks for a reset link and says the same thing whether or not the account exists', async () => {
    const calls = stub({ '/password/forgot': () => json(200, { ok: true }) });
    app('/forgot-password?email=ada%40example.com');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText(/If an account uses/)).toBeTruthy();
    expect(calls[0]).toEqual({ path: '/password/forgot', body: { email: 'ada@example.com' } });
  });

  it('shows a field error for an invalid address and a wait message when throttled', async () => {
    let n = 0;
    stub({ '/password/forgot': () => (++n === 1 ? fail(400, 'invalid_request', { fields: { email: 'Enter a valid email address.' } }) : new Response(JSON.stringify({ error: { code: 'too_many_emails', message: 'too many' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '1800' } })) });
    app('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/Too many emails were requested from your network\. Please try again in about 30 minutes\./)).toBeTruthy();
  });

  it('sets a new password from the link and goes to the dashboard', async () => {
    const calls = stub({ '/password/reset': () => json(200, { account: { id: 'acc_1' } }) });
    app('/reset-password?token=abc123');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and log in' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/dashboard'));
    expect(calls[0]).toEqual({ path: '/password/reset', body: { token: 'abc123', password: 'a brand new passphrase' } });
  });

  it('explains an expired reset link and offers a new one', async () => {
    stub({ '/password/reset': () => fail(400, 'invalid_token') });
    app('/reset-password?token=old');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and log in' }));
    expect(await screen.findByText(/This link has expired or was already used\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get a new link' }).getAttribute('href')).toBe('/forgot-password');
  });

  it('confirms an email from its link', async () => {
    const calls = stub({ '/email/verify': () => json(200, { verified: true, email: 'ada@example.com' }) });
    app('/verify-email?token=tok');
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(calls).toEqual([{ path: '/email/verify', body: { token: 'tok' } }]);
  });

  it('says when a verification link no longer works', async () => {
    stub({ '/email/verify': () => fail(400, 'invalid_token') });
    app('/verify-email?token=old');
    expect(await screen.findByRole('heading', { name: "We couldn't confirm your email" })).toBeTruthy();
    expect(screen.getByText('This link has expired or was already used.')).toBeTruthy();
  });
});
