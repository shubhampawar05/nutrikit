// Two app instances, one database: the plan's per-minute limit, login throttling and sessions are shared.
// Run with ./e2e/multi-instance.sh (starts the instances), or point NUTRIKIT_INSTANCES=urlA,urlB at your own.
// Exits non-zero if any check fails.
let failed = false;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed = true; };
const [A, B] = (process.env.NUTRIKIT_INSTANCES || 'http://127.0.0.1:8797,http://127.0.0.1:8798').split(',');
const portal = (base, path, body, cookie) => fetch(base + '/portal/api' + path, {
  method: body ? 'POST' : 'GET',
  headers: { 'X-Nutrikit-Portal': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

const email = `multi-${Date.now()}@example.com`;
const signup = await portal(A, '/signup', { name: 'Multi', email, password: 'correct horse battery' });
const cookie = signup.headers.get('set-cookie').split(';')[0];
const { firstKey, plan } = await signup.json();
console.log(`signed up on A: plan ${plan.id}, ${plan.ratePerMinute} requests/minute`);

// Session created on A is valid on B.
check('a session created on A is valid on B', (await portal(B, '/me', null, cookie)).status === 200);

// Burst: alternate instances until well past the plan's per-minute limit.
const statuses = [];
for (let i = 0; i < plan.ratePerMinute + 10; i++) {
  const res = await fetch(`${i % 2 ? B : A}/v1/foods/search?q=apple&limit=1`, { headers: { Authorization: `Bearer ${firstKey.key}` } });
  statuses.push({ n: i + 1, via: i % 2 ? 'B' : 'A', status: res.status, retry: res.headers.get('retry-after') });
  await res.arrayBuffer();
}
const ok = statuses.filter((s) => s.status === 200).length;
const first429 = statuses.find((s) => s.status === 429);
console.log(`burst of ${statuses.length} across A and B: ${ok} x 200, first 429 at request #${first429?.n} (via ${first429?.via}, Retry-After ${first429?.retry})`);
check('the per-minute limit is enforced at the plan limit across instances', ok === plan.ratePerMinute && first429?.n === plan.ratePerMinute + 1 && statuses.slice(plan.ratePerMinute).every((s) => s.status === 429));

// Login throttle: 5 wrong passwords split across A and B, then the right password is refused on B.
const wrong = [];
for (let i = 0; i < 5; i++) wrong.push((await portal(i % 2 ? B : A, '/login', { email, password: 'wrong password' })).status);
const right = await portal(B, '/login', { email, password: 'correct horse battery' });
const body = await right.json();
console.log(`5 wrong logins (A,B,A,B,A): ${wrong.join(',')}; correct password on B: ${right.status} ${body.error?.code} Retry-After ${right.headers.get('retry-after')}`);
check('failed logins are throttled across instances', wrong.every((s) => s === 401) && right.status === 429 && body.error?.code === 'too_many_attempts');
process.exit(failed ? 1 : 0);
