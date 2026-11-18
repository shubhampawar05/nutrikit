// Teams, roles, invitations and test keys.
import { sql, sentMail, fakeProvider } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';

const app = await buildApp();
const PASSWORD = 'correct horse battery';
let base;
let provider;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  provider = fakeProvider();
  setProvider(provider);
});
after(() => app.close());

function browser() {
  let cookie = '';
  return {
    async call(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-Nutrikit-Portal': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
    },
  };
}

const bearer = (credential, path, init = {}) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${credential}`, ...(init.headers || {}) } });
let counter = 0;
const email = (who = 'dev') => `${who}${++counter}-${Date.now()}@example.com`;

async function person(name = 'Person') {
  const b = browser();
  const addr = email(name.toLowerCase().replace(/\W/g, ''));
  const r = await b.call('POST', '/portal/api/signup', { name, email: addr, password: PASSWORD });
  assert.equal(r.status, 201);
  return { b, addr, me: r.body, key: r.body.firstKey.key };
}

/** Owner invites `who` with `role`; `who` accepts. Returns the token. */
async function join(owner, who, role) {
  const inv = await owner.b.call('POST', '/portal/api/invitations', { email: who.addr, role });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const token = sentMail.at(-1).text.match(/invite\?token=([\w-]+)/)[1];
  const ok = await who.b.call('POST', `/portal/api/invitations/${token}/accept`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return token;
}

test('signup makes the person the owner of a new Free team', async () => {
  const { me } = await person('Founder');
  assert.equal(me.team.role, 'owner');
  assert.equal(me.team.name, 'Founder');
  assert.equal(me.plan.id, 'free');
  assert.equal(me.teams.length, 1);
  assert.match(me.firstKey.key, /^nk_live_/);
  assert.equal(me.firstKey.mode, 'live');
  assert.deepEqual(me.testUsage, { used: 0, limit: 5000, remaining: 5000 });
});

test('an invitation is emailed, previewed, and accepted only by the invited email', async () => {
  const owner = await person('Acme Owner');
  const dev = await person('Dev');
  const stranger = await person('Stranger');

  const inv = await owner.b.call('POST', '/portal/api/invitations', { email: dev.addr.toUpperCase(), role: 'developer' });
  assert.equal(inv.status, 201);
  assert.match(inv.body.id, /^[a-f0-9]{12}$/);
  const mail = sentMail.at(-1);
  assert.equal(mail.to, dev.addr.toUpperCase());
  assert.match(mail.subject, /Acme Owner invited you to Acme Owner/);
  const token = mail.text.match(/invite\?token=([\w-]+)/)[1];

  const preview = await fetch(`${base}/portal/api/invitations/${token}`).then((r) => r.json());
  assert.deepEqual({ team: preview.team, role: preview.role, invitedBy: preview.invitedBy }, { team: 'Acme Owner', role: 'developer', invitedBy: 'Acme Owner' });

  const wrong = await stranger.b.call('POST', `/portal/api/invitations/${token}/accept`);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error.code, 'wrong_email');

  const ok = await dev.b.call('POST', `/portal/api/invitations/${token}/accept`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.team.name, 'Acme Owner', 'the session switches to the new team');
  assert.equal(ok.body.team.role, 'developer');
  assert.equal(ok.body.teams.length, 2);
  assert.equal(ok.body.user.emailVerified, true, 'the link reached the address');

  assert.equal((await dev.b.call('POST', `/portal/api/invitations/${token}/accept`)).status, 404, 'a link works once');
  const members = await owner.b.call('GET', '/portal/api/members');
  assert.deepEqual(members.body.members.map((m) => m.role), ['owner', 'developer']);
  assert.equal(members.body.invitations.length, 0);
});

test('invitations: validation, already a member, replace, revoke, and only owners and admins send them', async () => {
  const owner = await person('Inviter');
  const dev = await person('Dev');
  await join(owner, dev, 'developer');

  const bad = await owner.b.call('POST', '/portal/api/invitations', { email: 'nope', role: 'owner' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['email', 'role']);
  assert.equal((await owner.b.call('POST', '/portal/api/invitations', { email: dev.addr, role: 'admin' })).body.error.code, 'already_member');
  const devTry = await dev.b.call('POST', '/portal/api/invitations', { email: email(), role: 'developer' });
  assert.equal(devTry.status, 403);
  assert.equal(devTry.body.error.code, 'forbidden');

  const addr = email('newbie');
  await owner.b.call('POST', '/portal/api/invitations', { email: addr, role: 'developer' });
  const firstToken = sentMail.at(-1).text.match(/invite\?token=([\w-]+)/)[1];
  await owner.b.call('POST', '/portal/api/invitations', { email: addr, role: 'admin' });
  assert.equal((await fetch(`${base}/portal/api/invitations/${firstToken}`)).status, 404, 'a new invitation replaces the old one');
  const list = (await owner.b.call('GET', '/portal/api/members')).body.invitations;
  assert.deepEqual(list.map((i) => [i.email, i.role]), [[addr, 'admin']]);
  assert.equal((await owner.b.call('DELETE', `/portal/api/invitations/${list[0].id}`)).status, 200);
  assert.equal((await owner.b.call('GET', '/portal/api/members')).body.invitations.length, 0);
});

test('a team cannot grow past its plan, pending invitations included', async () => {
  const owner = await person('Full House');
  for (let i = 0; i < 4; i++) assert.equal((await owner.b.call('POST', '/portal/api/invitations', { email: email(), role: 'developer' })).status, 201);
  const over = await owner.b.call('POST', '/portal/api/invitations', { email: email(), role: 'developer' });
  assert.equal(over.status, 403);
  assert.equal(over.body.error.code, 'member_limit');
});

test('roles: developers manage test keys only; admins cannot touch owners; the last owner stays', async () => {
  const owner = await person('Roles Owner');
  const admin = await person('Admin');
  const dev = await person('Developer');
  await join(owner, admin, 'admin');
  await join(owner, dev, 'developer');
  const ids = Object.fromEntries((await owner.b.call('GET', '/portal/api/members')).body.members.map((m) => [m.name, m.userId]));

  const live = await dev.b.call('POST', '/portal/api/keys', { name: 'prod', mode: 'live' });
  assert.equal(live.status, 403);
  const test = await dev.b.call('POST', '/portal/api/keys', { name: 'ci', mode: 'test' });
  assert.equal(test.status, 201);
  assert.match(test.body.key, /^nk_test_/);
  const keys = (await dev.b.call('GET', '/portal/api/keys')).body.keys;
  assert.deepEqual(keys.map((k) => [k.name, k.mode, k.createdBy]), [['ci', 'test', 'Developer'], ['Default key', 'live', 'Roles Owner']]);
  const liveId = keys.find((k) => k.mode === 'live').id;
  assert.equal((await dev.b.call('DELETE', `/portal/api/keys/${liveId}`)).status, 403, 'developers cannot revoke live keys');
  assert.equal((await dev.b.call('POST', `/portal/api/keys/${liveId}/regenerate`)).status, 403);
  assert.equal((await dev.b.call('DELETE', `/portal/api/keys/${test.body.id}`)).status, 200);
  assert.equal((await dev.b.call('PATCH', '/portal/api/team', { name: 'Hijack' })).status, 403);
  assert.equal((await dev.b.call('POST', '/portal/api/upgrade', { plan: 'growth' })).status, 403);

  assert.equal((await admin.b.call('PATCH', `/portal/api/members/${ids['Roles Owner']}`, { role: 'developer' })).status, 403, 'admins cannot demote owners');
  assert.equal((await admin.b.call('PATCH', `/portal/api/members/${ids.Developer}`, { role: 'owner' })).status, 403, 'admins cannot make owners');
  assert.equal((await admin.b.call('PATCH', `/portal/api/members/${ids.Developer}`, { role: 'admin' })).status, 200);
  assert.equal((await admin.b.call('POST', '/portal/api/keys', { name: 'admin live', mode: 'live' })).status, 201);

  const demote = await owner.b.call('PATCH', `/portal/api/members/${ids['Roles Owner']}`, { role: 'admin' });
  assert.equal(demote.status, 409);
  assert.equal(demote.body.error.code, 'last_owner');
  assert.equal((await owner.b.call('DELETE', `/portal/api/members/${ids['Roles Owner']}`)).body.error.code, 'last_owner', 'the last owner cannot leave');
  assert.equal((await owner.b.call('PATCH', `/portal/api/members/${ids.Admin}`, { role: 'owner' })).status, 200);
  assert.equal((await owner.b.call('DELETE', `/portal/api/members/${ids['Roles Owner']}`)).status, 200, 'with a second owner, leaving works');
});

test('removing a member keeps the team keys working and moves the member to another team', async () => {
  const owner = await person('Keeper');
  const dev = await person('Leaver');
  await join(owner, dev, 'admin');
  const made = await dev.b.call('POST', '/portal/api/keys', { name: 'made by leaver' });
  const devId = (await owner.b.call('GET', '/portal/api/members')).body.members.find((m) => m.name === 'Leaver').userId;
  assert.equal((await owner.b.call('DELETE', `/portal/api/members/${devId}`)).status, 200);

  assert.equal((await bearer(made.body.key, '/v1/foods/search?q=apple')).status, 200, 'the key belongs to the team');
  const me = await dev.b.call('GET', '/portal/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.team.name, 'Leaver', 'back in their own team, never the one they left');
  assert.equal((await dev.b.call('GET', '/portal/api/keys')).body.keys.some((k) => k.name === 'made by leaver'), false);
});

test('users create and switch teams; switching to a team they are not in is refused', async () => {
  const a = await person('Switcher');
  const other = await person('Other');
  const created = await a.b.call('POST', '/portal/api/teams', { name: 'Side Project' });
  assert.equal(created.status, 201);
  assert.equal(created.body.team.name, 'Side Project');
  assert.equal(created.body.team.role, 'owner');
  assert.equal(created.body.teams.length, 2);
  const first = created.body.teams.find((t) => t.name === 'Switcher');
  const back = await a.b.call('POST', '/portal/api/teams/switch', { accountId: first.id });
  assert.equal(back.body.team.name, 'Switcher');
  assert.equal((await a.b.call('POST', '/portal/api/teams/switch', { accountId: other.me.team.id })).status, 404);
  assert.equal((await a.b.call('PATCH', '/portal/api/team', { name: 'Renamed' })).body.team.name, 'Renamed');
});

test('deleting a user is refused while they are the only owner of a team with members', async () => {
  const owner = await person('Sole Owner');
  const dev = await person('Stays');
  await join(owner, dev, 'developer');
  const refused = await owner.b.call('POST', '/portal/api/account/delete', { password: PASSWORD });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'sole_owner');

  const devDelete = await dev.b.call('POST', '/portal/api/account/delete', { password: PASSWORD });
  assert.equal(devDelete.status, 200, 'a developer can delete their login; their own solo team goes with it');
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM accounts WHERE id = ${dev.me.team.id}`;
  assert.equal(n, 0);
  assert.equal((await owner.b.call('GET', '/portal/api/members')).body.members.length, 1);
  assert.equal((await owner.b.call('POST', '/portal/api/account/delete', { password: PASSWORD })).status, 200, 'alone again, the owner can delete');
});

test('test keys: separate allowance, live figures unchanged, mode header', async () => {
  const owner = await person('Tester');
  const t = await owner.b.call('POST', '/portal/api/keys', { name: 'ci', mode: 'test' });
  const res = await bearer(t.body.key, '/v1/foods/search?q=apple');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-nutrikit-mode'), 'test');
  assert.equal(res.headers.get('x-tokens-remaining'), '4999');
  const live = await bearer(owner.key, '/v1/foods/search?q=apple');
  assert.equal(live.headers.get('x-nutrikit-mode'), null);
  assert.equal(live.headers.get('x-tokens-remaining'), '1999', 'the test call did not touch the plan');

  const me = (await owner.b.call('GET', '/portal/api/me')).body;
  assert.equal(me.usage.used, 1);
  assert.deepEqual(me.testUsage, { used: 1, limit: 5000, remaining: 4999 });
  const usage = (await owner.b.call('GET', '/portal/api/usage')).body;
  assert.equal(usage.series.at(-1).tokens, 1, 'the live chart leaves test calls out');
  const testUsage = await (await bearer(t.body.key, '/v1/usage')).json();
  assert.deepEqual({ mode: testUsage.mode, used: testUsage.used, limit: testUsage.tokenLimit }, { mode: 'test', used: 1, limit: 5000 });

  await sql`UPDATE usage_periods SET used = 5000 WHERE subject = ${`test:${owner.me.team.id}`}`;
  const out = await bearer(t.body.key, '/v1/foods/search?q=apple');
  assert.equal(out.status, 429);
  assert.match((await out.json()).error.message, /test allowance/);
  assert.equal((await bearer(owner.key, '/v1/foods/search?q=apple')).status, 200, 'live keys keep working');
});

test('test keys never call the AI provider and get sample answers in the real shape', async () => {
  const owner = await person('Sampler');
  const t = await owner.b.call('POST', '/portal/api/keys', { name: 'ci', mode: 'test' });
  const before = provider.calls.length;
  const photo = await bearer(t.body.key, '/v1/log/photo', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('iVBORw0KGgo=', 'base64') });
  assert.equal(photo.status, 200);
  const body = await photo.json();
  assert.equal(body.provider, 'test');
  assert.ok(body.items.length >= 2);
  assert.ok(body.totals.calories.amount > 0);
  assert.equal(photo.headers.get('x-tokens-charged'), '20', 'flat cost only, no AI tokens');

  const advice = await (await bearer(t.body.key, '/v1/advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Is dal healthy?' }) })).json();
  assert.equal(advice.provider, 'test');
  const text = await (await bearer(t.body.key, '/v1/log/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '2 eggs and a banana', ai: true }) })).json();
  assert.equal(text.provider, 'test');
  assert.ok(text.items.length >= 2);
  const label = await (await bearer(t.body.key, '/v1/labels/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'iVBORw0KGgo=', mediaType: 'image/png' }) })).json();
  assert.equal(label.provider, 'test');
  assert.equal(label.perServing.calories.amount, 210);
  assert.equal(provider.calls.length, before, 'the real provider was never called');
});

test('key limits count live and test keys separately', async () => {
  const owner = await person('Limits');
  assert.equal((await owner.b.call('POST', '/portal/api/keys', { name: 'second live' })).status, 201);
  const over = await owner.b.call('POST', '/portal/api/keys', { name: 'third live' });
  assert.equal(over.status, 403);
  assert.equal(over.body.error.code, 'key_limit');
  assert.equal((await owner.b.call('POST', '/portal/api/keys', { name: 't1', mode: 'test' })).status, 201);
  assert.equal((await owner.b.call('POST', '/portal/api/keys', { name: 't2', mode: 'test' })).status, 201);
  assert.equal((await owner.b.call('POST', '/portal/api/keys', { name: 't3', mode: 'test' })).status, 403);
  assert.equal((await owner.b.call('POST', '/portal/api/keys', { name: 'x', mode: 'staging' })).status, 400);
});

test('the admin console lists teams with their owner, members and key modes', async () => {
  const owner = await person('Admin View');
  const dev = await person('Member');
  await join(owner, dev, 'developer');
  await owner.b.call('POST', '/portal/api/keys', { name: 'ci', mode: 'test' });
  const ADMIN = { Authorization: 'Bearer test-admin-token' };
  const { accounts } = await (await fetch(`${base}/v1/admin/accounts?q=${encodeURIComponent(dev.addr)}`, { headers: ADMIN })).json();
  const team = accounts.find((a) => a.id === owner.me.team.id);
  assert.ok(team, "searching a member's email finds the team");
  assert.deepEqual({ email: team.email, members: team.members, activeKeys: team.activeKeys }, { email: owner.addr, members: 2, activeKeys: 1 });
  const { keys } = await (await fetch(`${base}/v1/admin/keys?q=${encodeURIComponent('Admin View')}`, { headers: ADMIN })).json();
  assert.deepEqual(keys.map((k) => k.mode).sort(), ['live', 'test']);
});

test('one person can own at most NUTRIKIT_TEAMS_PER_USER teams (default 3), so free allowances cannot be farmed', async () => {
  const a = await person('Farmer');
  assert.equal((await a.b.call('POST', '/portal/api/teams', { name: 'Two' })).status, 201);
  assert.equal((await a.b.call('POST', '/portal/api/teams', { name: 'Three' })).status, 201);
  const over = await a.b.call('POST', '/portal/api/teams', { name: 'Four' });
  assert.equal(over.status, 403);
  assert.equal(over.body.error.code, 'team_limit');
  const parallel = await Promise.all([1, 2, 3].map(() => a.b.call('POST', '/portal/api/teams', { name: 'Race' })));
  assert.ok(parallel.every((r) => r.status === 403));
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = ${a.addr} AND m.role = 'owner'`;
  assert.equal(n, 3);
});

test('invitations do not use the per-network email limit, and have their own per-team and per-address limits', async () => {
  const before = { ip: process.env.NUTRIKIT_EMAIL_IP_LIMIT, invites: process.env.NUTRIKIT_INVITE_LIMIT };
  process.env.NUTRIKIT_EMAIL_IP_LIMIT = '2';
  process.env.NUTRIKIT_INVITE_LIMIT = '6';
  try {
    const owner = await person('Onboarder');
    // Revoking frees the seat but not the hourly count, so this sends six invitations from one network.
    for (let i = 0; i < 6; i++) {
      const r = await owner.b.call('POST', '/portal/api/invitations', { email: email('hire'), role: 'developer' });
      assert.equal(r.status, 201, `invitation ${i + 1}: ${JSON.stringify(r.body)}`);
      await owner.b.call('DELETE', `/portal/api/invitations/${r.body.id}`);
    }
    const team = await owner.b.call('POST', '/portal/api/invitations', { email: email('hire'), role: 'developer' });
    assert.equal(team.status, 429);
    assert.equal(team.body.error.code, 'too_many_invitations');

    const other = await person('Repeat');
    const addr = email('again');
    for (let i = 0; i < 3; i++) assert.equal((await other.b.call('POST', '/portal/api/invitations', { email: addr, role: 'developer' })).status, 201);
    const address = await other.b.call('POST', '/portal/api/invitations', { email: addr, role: 'developer' });
    assert.equal(address.status, 429);
    assert.equal(address.body.error.code, 'too_many_emails');
  } finally {
    process.env.NUTRIKIT_EMAIL_IP_LIMIT = before.ip;
    process.env.NUTRIKIT_INVITE_LIMIT = before.invites;
  }
});

test('parallel invitations cannot take more seats than the plan has', async () => {
  const owner = await person('Rush Owner');
  const results = await Promise.all(Array.from({ length: 8 }, () => owner.b.call('POST', '/portal/api/invitations', { email: email(), role: 'developer' })));
  const statuses = results.map((r) => r.status);
  // Free allows 5 people: the owner and 4 invitations.
  assert.equal(statuses.filter((s) => s === 201).length, 4, `statuses: ${statuses}`);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'member_limit'));
});

test('a member demoted since signing in is judged by their current role', async () => {
  const { changeRole, removeMember } = await import('../src/domain/teams.ts');
  const owner = await person('Demoter');
  const admin = await person('Demoted');
  const dev = await person('Bystander');
  await join(owner, admin, 'admin');
  await join(owner, dev, 'developer');
  const team = owner.me.team.id;
  const adminId = admin.me.user.id;
  await changeRole(sql, team, { userId: owner.me.user.id, role: 'owner' }, adminId, 'developer');
  // The admin's session still says 'admin'.
  await assert.rejects(changeRole(sql, team, { userId: adminId, role: 'admin' }, dev.me.user.id, 'admin'), { code: 'forbidden' });
  await assert.rejects(removeMember(sql, team, { userId: adminId, role: 'admin' }, dev.me.user.id), { code: 'forbidden' });
  await removeMember(sql, team, { userId: adminId, role: 'admin' }, adminId); // leaving is always allowed
});

test('an owner deleting their login while the other owner leaves never leaves a team without an owner', async () => {
  const { deleteAccount } = await import('../src/domain/accounts.ts');
  const { removeMember } = await import('../src/domain/teams.ts');
  for (let round = 0; round < 3; round++) {
    const a = await person('Owner A');
    const b = await person('Owner B');
    const c = await person('Member C');
    await join(a, b, 'admin');
    await join(a, c, 'developer');
    const team = a.me.team.id;
    await a.b.call('PATCH', `/portal/api/members/${b.me.user.id}`, { role: 'owner' });
    await Promise.allSettled([
      deleteAccount(sql, a.me.user.id, PASSWORD),
      removeMember(sql, team, { userId: b.me.user.id, role: 'owner' }, b.me.user.id),
    ]);
    const [{ owners }] = await sql`SELECT COUNT(*)::int AS owners FROM memberships WHERE account_id = ${team} AND role = 'owner'`;
    assert.equal(owners, 1, `round ${round}`);
  }
});

test('parallel requests from a user with no team create exactly one team', async () => {
  const { createSession, sessionContext } = await import('../src/domain/accounts.ts');
  const p = await person('Teamless');
  const userId = p.me.user.id;
  await sql`DELETE FROM accounts WHERE id = ${p.me.team.id}`;
  const { token } = await createSession(sql, userId);
  const contexts = await Promise.all(Array.from({ length: 6 }, () => sessionContext(sql, token)));
  assert.equal(new Set(contexts.map((c) => c.account.id)).size, 1);
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM memberships WHERE user_id = ${userId}`;
  assert.equal(n, 1);
});
