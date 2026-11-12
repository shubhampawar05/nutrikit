import { sql, seedUsage } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { setPlan } from '../src/domain/accounts.ts';
import { Nutrikit } from '../../sdk/js/nutrikit.mjs';

const app = await buildApp();

let base;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  setProvider({ name: 'none' });
});
after(() => app.close());

// Minimal cookie-keeping portal client.
function browser() {
  let cookie = '';
  return {
    async call(method, path, body, { csrf = true } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-Nutrikit-Portal': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
const email = () => `dev${++counter}-${Date.now()}@example.com`;

test('signup validates fields and rejects duplicates', async () => {
  const b = browser();
  const bad = await b.call('POST', '/portal/api/signup', { name: '', email: 'nope', password: 'short' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['email', 'name', 'password']);
  const addr = email();
  const ok = await b.call('POST', '/portal/api/signup', { name: 'Acme Health', email: addr, password: 'correct horse battery' });
  assert.equal(ok.status, 201);
  assert.match(ok.headers.get('set-cookie'), /nk_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  assert.match(ok.body.firstKey.key, /^nk_/);
  assert.equal(ok.body.plan.id, 'free');
  const dup = await browser().call('POST', '/portal/api/signup', { name: 'Again', email: addr.toUpperCase(), password: 'correct horse battery' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'email_taken');
  const [stored] = await sql`SELECT password_hash FROM accounts WHERE email = ${addr}`;
  assert.match(stored.password_hash, /^scrypt\$/);
});

test('first key works immediately and usage is metered to the account', async () => {
  const b = browser();
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Meter Co', email: email(), password: 'correct horse battery' });
  const r = await bearer(body.firstKey.key, '/v1/foods/search?q=apple');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-tokens-remaining'), '1999');
  const me = await b.call('GET', '/portal/api/me');
  assert.equal(me.body.usage.used, 1);
  assert.equal(me.body.usage.remaining, 1999);
  const usage = await b.call('GET', '/portal/api/usage?days=30');
  assert.equal(usage.body.series.length, 30);
  assert.equal(usage.body.series.at(-1).tokens, 1);
  assert.deepEqual(usage.body.month.byEndpoint, [{ endpoint: 'search', calls: 1, tokens: 1 }]);
  const keys = await b.call('GET', '/portal/api/keys');
  assert.ok(keys.body.keys[0].lastUsedAt);
  assert.equal(keys.body.keys[0].key, undefined, 'plaintext keys are never listed');
});

test('portal requires a session and the CSRF header', async () => {
  const anon = browser();
  assert.equal((await anon.call('GET', '/portal/api/me')).status, 401);
  const b = browser();
  await b.call('POST', '/portal/api/signup', { name: 'Csrf Co', email: email(), password: 'correct horse battery' });
  const noHeader = await b.call('POST', '/portal/api/keys', { name: 'x' }, { csrf: false });
  assert.equal(noHeader.status, 403);
  assert.equal(noHeader.body.error.code, 'csrf');
  const res = await fetch(`${base}/portal/api/me`);
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'portal is not CORS-enabled');
});

test('login, throttling and logout', async () => {
  const addr = email();
  await browser().call('POST', '/portal/api/signup', { name: 'Login Co', email: addr, password: 'correct horse battery' });
  const b = browser();
  const wrong = await b.call('POST', '/portal/api/login', { email: addr, password: 'nope nope nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'invalid_credentials');
  assert.equal((await b.call('POST', '/portal/api/login', { email: 'nobody@example.com', password: 'whatever123' })).status, 401);
  const ok = await b.call('POST', '/portal/api/login', { email: addr, password: 'correct horse battery' });
  assert.equal(ok.status, 200);
  assert.equal((await b.call('GET', '/portal/api/me')).status, 200);
  await b.call('POST', '/portal/api/logout');
  assert.equal((await b.call('GET', '/portal/api/me')).status, 401);
  for (let i = 0; i < 5; i++) await browser().call('POST', '/portal/api/login', { email: addr, password: 'wrong password!' });
  const locked = await browser().call('POST', '/portal/api/login', { email: addr, password: 'correct horse battery' });
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('retry-after'), '900');
});

test('keys: create, plan limit, revoke', async () => {
  const b = browser();
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Keys Co', email: email(), password: 'correct horse battery' });
  const second = await b.call('POST', '/portal/api/keys', { name: 'Android' });
  assert.equal(second.status, 201);
  assert.match(second.body.key, /^nk_/);
  const third = await b.call('POST', '/portal/api/keys', { name: 'Too many' });
  assert.equal(third.status, 403, 'free plan allows 2 active keys');
  assert.equal(third.body.error.code, 'key_limit');
  assert.equal((await b.call('DELETE', `/portal/api/keys/${second.body.id}`)).status, 200);
  assert.equal((await bearer(second.body.key, '/v1/usage')).status, 401);
  assert.equal((await b.call('POST', '/portal/api/keys', { name: 'Replacement' })).status, 201);
  // Another account cannot revoke this account's key.
  const other = browser();
  await other.call('POST', '/portal/api/signup', { name: 'Other', email: email(), password: 'correct horse battery' });
  assert.equal((await other.call('DELETE', `/portal/api/keys/${body.firstKey.id}`)).status, 404);
});

test('the plan allowance is shared by all keys and enforced', async () => {
  const b = browser();
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Quota Co', email: email(), password: 'correct horse battery' });
  const k2 = (await b.call('POST', '/portal/api/keys', { name: 'second' })).body.key;
  const accountId = body.account.id;
  await seedUsage({ keyId: body.firstKey.id, accountId, tokens: 1999 });
  assert.equal((await bearer(k2, '/v1/foods/search?q=egg')).status, 200, 'last token');
  const over = await bearer(body.firstKey.key, '/v1/foods/search?q=egg');
  assert.equal(over.status, 429);
  assert.equal((await over.json()).error.code, 'quota_exceeded');
  await setPlan(sql, accountId, 'starter');
  assert.equal((await bearer(body.firstKey.key, '/v1/foods/search?q=egg')).status, 200, 'upgrade lifts the limit');
  const me = await b.call('GET', '/portal/api/me');
  assert.equal(me.body.plan.name, 'Starter');
});

test('access tokens: exchange, use, no re-minting, expiry, revocation', async () => {
  const b = browser();
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Token Co', email: email(), password: 'correct horse battery' });
  const ex = await bearer(body.firstKey.key, '/v1/auth/token', { method: 'POST' });
  assert.equal(ex.status, 200);
  assert.equal(ex.headers.get('x-tokens-charged'), '0');
  const token = await ex.json();
  assert.match(token.access_token, /^nkat_/);
  assert.equal(token.token_type, 'Bearer');
  assert.equal(token.expires_in, 3600);
  const used = await bearer(token.access_token, '/v1/foods/search?q=rice');
  assert.equal(used.status, 200);
  assert.equal(used.headers.get('x-tokens-remaining'), '1999', 'charged to the same account');
  assert.equal((await bearer(token.access_token, '/v1/auth/token', { method: 'POST' })).status, 403);
  const tampered = token.access_token.slice(0, -2) + (token.access_token.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await bearer(tampered, '/v1/usage')).status, 401);
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600 * 1000;
  try {
    const expired = await bearer(token.access_token, '/v1/usage');
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).error.code, 'token_expired');
  } finally {
    Date.now = realNow;
  }
  await b.call('DELETE', `/portal/api/keys/${body.firstKey.id}`);
  assert.equal((await bearer(token.access_token, '/v1/usage')).status, 401, 'revoking the key kills its tokens');
});

test('SDK createAccessToken and token-based client', async () => {
  const { body } = await browser().call('POST', '/portal/api/signup', { name: 'SDK Co', email: email(), password: 'correct horse battery' });
  const serverSide = new Nutrikit({ apiKey: body.firstKey.key, baseUrl: base });
  const t = await serverSide.createAccessToken();
  const client = new Nutrikit({ apiKey: t.access_token, baseUrl: base });
  const r = await client.searchFoods('banana', { limit: 1 });
  assert.equal(r.results[0].name, 'Banana, raw');
});

test('upgrade requests are recorded', async () => {
  const b = browser();
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Grow Co', email: email(), password: 'correct horse battery' });
  assert.equal((await b.call('POST', '/portal/api/upgrade', { plan: 'free' })).status, 400);
  const r = await b.call('POST', '/portal/api/upgrade', { plan: 'growth', message: '50k MAU' });
  assert.equal(r.status, 201);
  const [row] = await sql`SELECT plan, message FROM upgrade_requests WHERE account_id = ${body.account.id}`;
  assert.deepEqual({ ...row }, { plan: 'growth', message: '50k MAU' });
  const admin = { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' };
  const list = await (await fetch(`${base}/v1/admin/upgrade-requests`, { headers: admin })).json();
  assert.ok(list.requests.some((x) => x.accountId === body.account.id && x.requestedPlan === 'growth' && x.currentPlan === 'free'));
  const set = await fetch(`${base}/v1/admin/accounts/${body.account.id}/plan`, { method: 'POST', headers: admin, body: JSON.stringify({ plan: 'growth' }) });
  assert.equal(set.status, 200);
  assert.equal((await b.call('GET', '/portal/api/me')).body.plan.id, 'growth');
  assert.equal((await fetch(`${base}/v1/admin/accounts/${body.account.id}/plan`, { method: 'POST', headers: admin, body: JSON.stringify({ plan: 'platinum' }) })).status, 400);
  assert.equal((await fetch(`${base}/v1/admin/upgrade-requests`)).status, 401);
});

test('the web app is served for page URLs, with API paths left alone', async () => {
  for (const path of ['/', '/pricing', '/docs', '/docs/', '/docs/reference', '/signup', '/login', '/dashboard', '/playground', '/no-such-page']) {
    const res = await fetch(base + path, { headers: { Accept: 'text/html,application/xhtml+xml' } });
    assert.equal(res.status, path === '/no-such-page' ? 404 : 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/, path);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', path);
    assert.equal(res.headers.get('cache-control'), 'no-cache', path);
    assert.ok((await res.text()).includes('<div id="root">'), `${path} is the app shell`);
  }
  const asset = await fetch(`${base}/assets/app-3f9a1c.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${base}/favicon.svg`)).headers.get('cache-control'), 'no-cache');
  for (const path of ['/assets/missing-000.js', '/logo.png']) {
    assert.equal((await fetch(base + path, { headers: { Accept: 'text/html' } })).status, 404, `${path} is not the app shell`);
  }
  for (const path of ['/v1/nope', '/portal/api/nope', '/openapi.json/x']) {
    const res = await fetch(base + path, { headers: { Accept: 'text/html' } });
    assert.equal(res.status, 404, path);
    assert.equal((await res.json()).error.code, 'not_found', path);
  }
  assert.equal((await fetch(`${base}/v1/foods/search`, { method: 'PUT', headers: { Accept: 'text/html' } })).status, 405);
  assert.equal((await fetch(`${base}/sdk/nutrikit.d.ts`)).status, 200);
  const nutrients = await (await fetch(`${base}/v1/nutrients`)).json();
  assert.equal(nutrients.nutrients.length, 33, 'nutrient catalog is public');
});

test('pages carry their own title, description, canonical URL and robots rule', async () => {
  const page = async (path, headers = {}) => {
    const res = await fetch(base + path, { headers: { Accept: 'text/html', ...headers } });
    return { status: res.status, html: await res.text() };
  };
  const docs = await page('/docs/', { 'X-Forwarded-Proto': 'https' });
  assert.match(docs.html, /<title>Documentation — Nutrikit Nutrition API<\/title>/);
  assert.match(docs.html, /<meta name="description" content="Quick start, authentication and guides/);
  assert.equal(docs.html.match(/<meta name="description"/g).length, 1, 'one description');
  assert.match(docs.html, new RegExp(`<link rel="canonical" href="https://${new URL(base).host}/docs">`));
  assert.match(docs.html, /<meta name="robots" content="index, follow">/);
  assert.match(docs.html, /<meta property="og:image" content="https:\/\/[^"]+\/og-image.png">/);
  assert.match(docs.html, /<meta name="twitter:card" content="summary_large_image">/);
  // Pricing is hidden while payments are off (web/src/features.ts): kept out of search results.
  assert.match((await page('/pricing')).html, /<meta name="robots" content="noindex, follow">/);

  const home = await page('/');
  const [, json] = home.html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
  assert.deepEqual(JSON.parse(json).map((d) => d['@type']), ['Organization', 'WebSite']);

  assert.match((await page('/dashboard')).html, /<meta name="robots" content="noindex, follow">/);
  const missing = await page('/no-such-page');
  assert.equal(missing.status, 404);
  assert.match(missing.html, /<title>Page not found — Nutrikit<\/title>/);
  assert.match(missing.html, /noindex/);
  assert.doesNotMatch(missing.html, /rel="canonical"/);

  // A forged Host header can't break out of the attribute.
  const forged = await page('/pricing', { Host: 'evil.test"><script>x</script>' }).catch(() => null);
  if (forged) assert.doesNotMatch(forged.html, /<script>x<\/script>/);
});

test('robots.txt and sitemap.xml list the public pages with absolute URLs', async () => {
  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  const text = await robots.text();
  assert.match(text, /^User-agent: \*$/m);
  assert.match(text, /^Disallow: \/v1\/$/m);
  assert.match(text, new RegExp(`^Sitemap: http://${new URL(base).host}/sitemap.xml$`, 'm'));

  const sitemap = await fetch(`${base}/sitemap.xml`);
  assert.match(sitemap.headers.get('content-type'), /application\/xml/);
  const xml = await sitemap.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  assert.deepEqual(locs, ['/', '/docs', '/docs/reference', '/playground', '/privacy', '/terms', '/signup']); // /pricing is hidden while payments are off
  assert.doesNotMatch(xml, /dashboard|admin|login/);
});

test('homepage demo: works without an account, needs the CSRF header, is rate limited', async () => {
  const demo = (body, csrf = true) => fetch(`${base}/portal/api/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Nutrikit-Portal': '1' } : {}) },
    body: JSON.stringify(body),
  });
  const ok = await demo({ text: 'a banana and a coffee' });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).items.map((i) => i.food.name), ['Banana, raw', 'Coffee, brewed']);
  assert.equal((await demo({ text: 'a banana' }, false)).status, 403);
  assert.equal((await demo({ text: 'x'.repeat(201) })).status, 400);
  let last;
  for (let i = 0; i < 20; i++) last = await demo({ text: 'an apple' });
  assert.equal(last.status, 429, '20 per minute per IP (2 already used above)');
  assert.equal(last.headers.get('retry-after'), '60');
});

test('playground token: signed-in users get a working 1-hour token for their newest key', async () => {
  const b = browser();
  assert.equal((await b.call('POST', '/portal/api/playground-token')).status, 401, 'needs a session');
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Playground Co', email: email(), password: 'correct horse battery' });
  const t = await b.call('POST', '/portal/api/playground-token');
  assert.equal(t.status, 200);
  assert.match(t.body.access_token, /^nkat_/);
  assert.deepEqual(t.body.key, { id: body.firstKey.id, name: 'Default key' });
  assert.equal((await bearer(t.body.access_token, '/v1/foods/search?q=apple')).status, 200);
  await b.call('DELETE', `/portal/api/keys/${body.firstKey.id}`);
  const none = await b.call('POST', '/portal/api/playground-token');
  assert.equal(none.status, 409);
  assert.equal(none.body.error.code, 'no_active_key');
});

test('the plans are public, cacheable, and only the display fields', async () => {
  const res = await fetch(`${base}/portal/api/plans`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /public, max-age=300/);
  const { plans, currency } = await res.json();
  assert.equal(currency, 'INR');
  assert.deepEqual(Object.keys(plans), ['free', 'starter', 'growth', 'enterprise'], 'ordered by rank');
  assert.deepEqual(Object.values(plans).map((p) => p.rank), [0, 1, 2, 3]);
  for (const p of Object.values(plans)) {
    assert.deepEqual(Object.keys(p).sort(), ['currency', 'maxKeys', 'monthlyTokens', 'name', 'price', 'rank', 'ratePerMinute']);
  }
  assert.equal(plans.starter.price, 1499);
  assert.equal(plans.enterprise.price, null);
  // Other portal responses stay uncacheable.
  assert.equal((await fetch(`${base}/portal/api/me`)).headers.get('cache-control'), 'no-store');
});
