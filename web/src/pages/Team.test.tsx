import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { choose, openSelect, optionLabels, renderPage } from '../test-utils.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Invite } from './Invite.tsx';
import type { Me, Member, Role } from '../api/client.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const plan = { name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, maxMembers: 5, rank: 0 };
const meAs = (role: Role, email = 'dev@acme.test'): Me => ({
  account: { id: 'usr_2', name: 'Dee', email, createdAt: '2026-10-01T00:00:00Z' },
  user: { id: 'usr_2', name: 'Dee', email, emailVerified: true, createdAt: '2026-10-01T00:00:00Z' },
  team: { id: 'acct_acme', name: 'Acme Health', role, createdAt: '2026-10-01T00:00:00Z' },
  teams: [{ id: 'acct_acme', name: 'Acme Health', role, plan: 'free' }, { id: 'acct_own', name: 'Dee', role: 'owner', plan: 'free' }],
  plan: { id: 'free', ...plan, expiresAt: null },
  usage: { periodStart: '2026-10-01T00:00:00Z', used: 10, remaining: 1990 },
  testUsage: { used: 3, limit: 5000, remaining: 4997 },
  plans: { free: plan },
  billing: { enabled: false, mode: null, currency: 'INR', keyId: null },
});
const members: Member[] = [
  { userId: 'usr_1', name: 'Olu Owner', email: 'olu@acme.test', role: 'owner', joinedAt: '2026-10-01T00:00:00Z' },
  { userId: 'usr_2', name: 'Dee', email: 'dev@acme.test', role: 'developer', joinedAt: '2026-10-02T00:00:00Z' },
];

function stub(me: Me | null, extra: (path: string, method: string, body: unknown) => Response | undefined = () => undefined) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/portal/api', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const answer = extra(path, method, body);
    if (answer) return answer;
    if (path === '/me') return me ? json(200, me) : json(401, { error: { code: 'unauthorized', message: 'please log in' } });
    if (path === '/keys') return json(200, { keys: [{ id: 'key_live', name: 'Prod', mode: 'live', createdBy: 'Olu Owner', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: null, revokedAt: null, usedThisMonth: 10 }] });
    if (path.startsWith('/usage')) return json(200, { series: [], month: { periodStart: '2026-10-01T00:00:00Z', tokenLimit: 2000, used: 10, remaining: 1990, byEndpoint: [] } });
    if (path === '/members') return json(200, { members, invitations: [{ id: 'abcdef123456', email: 'new@acme.test', role: 'admin', invitedBy: 'Olu Owner', expiresAt: '2026-11-20T00:00:00Z', createdAt: '2026-11-13T00:00:00Z' }], maxMembers: 5 });
    return json(404, { error: { code: 'not_found', message: 'not found' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard for team members', () => {
  const dashboard = () => renderPage(<Routes><Route path="/dashboard" element={<Dashboard />} /><Route path="*" element={<Where />} /></Routes>, { path: '/dashboard' });

  it('a developer sees the team and members, can leave, and can only create test keys', async () => {
    stub(meAs('developer'));
    dashboard();
    expect(await screen.findByRole('heading', { name: /Team: Acme Health/ })).toBeTruthy();
    const select = screen.getByLabelText('Team');
    expect(select.textContent).toBe('Acme Health (Developer)');
    expect(optionLabels(select)).toEqual(['Acme Health (Developer)', 'Dee (Owner)']);
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    await screen.findByText('Olu Owner');
    expect(screen.queryByLabelText('Email to invite')).toBeNull();
    expect(screen.queryByLabelText('Role for Olu Owner')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Olu Owner' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave team' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Revoke invitation/ })).toBeNull();

    const keyType = screen.getByLabelText('Key type');
    expect(keyType.textContent).toBe('Test');
    expect(within(openSelect(keyType)).getByRole('option', { name: 'Live (owners and admins)' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(keyType, { key: 'Escape' });
    await screen.findByText('Prod');
    expect(screen.queryByRole('button', { name: 'Revoke Prod' })).toBeNull();
    expect(screen.getByText(/Test keys: 3 of 5,000 test tokens/)).toBeTruthy();
  });

  it('an owner invites people and changes roles', async () => {
    const fetchMock = stub({ ...meAs('owner', 'olu@acme.test'), user: { ...meAs('owner').user, id: 'usr_1', name: 'Olu Owner', email: 'olu@acme.test' } }, (path, method, body) => {
      if (path === '/invitations' && method === 'POST') return json(201, { id: 'fedcba654321', email: (body as { email: string }).email, role: 'developer', invitedBy: 'Olu Owner', expiresAt: '2026-11-22T00:00:00Z', createdAt: '2026-11-15T00:00:00Z' });
      if (path === '/members/usr_2' && method === 'PATCH') return json(200, { members });
      return undefined;
    });
    dashboard();
    fireEvent.change(await screen.findByLabelText('Email to invite'), { target: { value: 'sam@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText('Invitation sent to sam@acme.test')).toBeTruthy();
    const sent = fetchMock.mock.calls.find(([u, i]) => String(u) === '/portal/api/invitations' && i?.method === 'POST');
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ email: 'sam@acme.test', role: 'developer' });

    const role = await screen.findByLabelText('Role for Dee');
    expect(optionLabels(role)).toEqual(['Owner', 'Admin', 'Developer']);
    choose(role, 'Admin');
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/portal/api/members/usr_2' && i?.method === 'PATCH')).toBe(true));
    expect(screen.getByText('3 of 5 seats on the Free plan')).toBeTruthy();
    expect(within(screen.getByText('new@acme.test').closest('tr')!).getByText('pending')).toBeTruthy();
  });
});

describe('Team edge cases', () => {
  const dashboard = () => renderPage(<Routes><Route path="/dashboard" element={<Dashboard />} /><Route path="*" element={<Where />} /></Routes>, { path: '/dashboard' });
  const owner = (): Me => ({ ...meAs('owner', 'olu@acme.test'), user: { ...meAs('owner').user, id: 'usr_1', name: 'Olu Owner', email: 'olu@acme.test' } });

  it('the only owner is not offered a role change, removal or leaving', async () => {
    stub(owner());
    dashboard();
    await screen.findByLabelText('Role for Dee');
    expect(screen.queryByLabelText('Role for Olu Owner')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave team' })).toBeNull();
    expect(screen.getByLabelText('Role for Dee')).toBeTruthy();
  });

  it('switching to a team where you are a developer resets the key type to test', async () => {
    let current = owner();
    stub(null, (path, method) => {
      if (path === '/me') return json(200, current);
      if (path === '/teams/switch' && method === 'POST') {
        current = { ...meAs('developer'), team: { ...meAs('developer').team, id: 'acct_other', name: 'Other' } };
        return json(200, current);
      }
      return undefined;
    });
    dashboard();
    expect((await screen.findByLabelText('Key type')).textContent).toBe('Live');
    choose(screen.getByLabelText('Team'), 'Dee (Owner)');
    await waitFor(() => expect(screen.getByLabelText('Key type').textContent).toBe('Test'));
  });
});

describe('Invite page', () => {
  const invite = (token = 'tok_abcdefghijklmnopqrstuvwxyz') => renderPage(
    <Routes><Route path="/invite" element={<Invite />} /><Route path="*" element={<Where />} /></Routes>, { path: `/invite?token=${token}` },
  );
  const preview = { team: 'Acme Health', invitedBy: 'Olu Owner', email: 'dev@acme.test', role: 'developer', expiresAt: '2026-11-22T00:00:00Z' };

  it('signed out: offers signup and login with the invited email, coming back here', async () => {
    stub(null, (path) => (path.startsWith('/invitations/') ? json(200, preview) : undefined));
    invite();
    expect(await screen.findByRole('heading', { name: 'Join Acme Health' })).toBeTruthy();
    const signup = screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')!;
    expect(signup).toContain('email=dev%40acme.test');
    expect(decodeURIComponent(signup)).toContain('next=/invite?token=tok_abcdefghijklmnopqrstuvwxyz');
  });

  it('signed in with the invited email: joining goes to the dashboard', async () => {
    stub(meAs('owner'), (path, method) => {
      if (path.startsWith('/invitations/') && method === 'POST') return json(200, meAs('developer'));
      if (path.startsWith('/invitations/')) return json(200, preview);
      return undefined;
    });
    invite();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Acme Health' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/dashboard'));
  });

  it('signed in with another email: explains and offers to log out', async () => {
    stub(meAs('owner', 'someone@else.test'), (path) => (path.startsWith('/invitations/') ? json(200, preview) : undefined));
    invite();
    expect(await screen.findByText(/this invitation is for/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join Acme Health' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });

  it('an expired or used link says so', async () => {
    stub(null, (path) => (path.startsWith('/invitations/') ? json(404, { error: { code: 'invalid_invitation', message: 'expired' } }) : undefined));
    invite();
    expect(await screen.findByRole('heading', { name: "This invitation doesn't work" })).toBeTruthy();
  });
});
