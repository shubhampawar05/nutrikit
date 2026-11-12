import './helpers.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildApp } from '../src/app.ts';

const ADMIN = { Authorization: 'Bearer test-admin-token' };
const closers = [];
after(() => Promise.all(closers.map((close) => close())));

/** A stand-in chat webhook that records every alert posted to it. */
async function webhook({ status = 200 } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(status).end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, received };
}

/** An app with two test routes: one that fails unexpectedly, one that fails as an upstream outage (502). */
async function start(opts = {}) {
  const app = await buildApp(opts);
  app.get('/test/boom', { schema: { hide: true } }, async () => { throw new TypeError('cannot read properties of undefined'); });
  app.get('/test/upstream', { schema: { hide: true } }, async () => { throw Object.assign(new Error('upstream down'), { status: 502 }); });
  await app.listen({ port: 0, host: '127.0.0.1' });
  closers.push(() => app.close());
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}

test('metrics: admin only; counts by route and status with latency percentiles', async () => {
  const { base } = await start();
  assert.equal((await fetch(`${base}/v1/admin/metrics`)).status, 401);

  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/v1/health`)).status, 200);
  assert.equal((await fetch(`${base}/v1/nope`)).status, 404);
  assert.equal((await fetch(`${base}/test/boom`)).status, 500);

  const res = await fetch(`${base}/v1/admin/metrics`, { headers: ADMIN });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const m = await res.json();
  const health = m.routes.find((r) => r.route === 'GET /v1/health');
  assert.equal(health.count, 3);
  assert.equal(health.byStatus['2xx'], 3);
  assert.equal(typeof health.p50Ms, 'number');
  assert.ok(health.p99Ms >= health.p50Ms);
  assert.equal(m.routes.find((r) => r.route === 'GET /test/boom').byStatus['5xx'], 1);
  assert.equal(m.routes.find((r) => r.route === 'GET (no route)').byStatus['4xx'], 1);
  assert.ok(m.requests.total >= 5);
  assert.ok(m.requests.last5Minutes.serverErrors >= 1);
  assert.ok(m.process.rssMb > 0);
  assert.equal(m.alerts.configured, false);
});

test('metrics: Prometheus text format', async () => {
  const { base } = await start();
  await fetch(`${base}/v1/health`);
  const res = await fetch(`${base}/v1/admin/metrics?format=prometheus`, { headers: ADMIN });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const text = await res.text();
  assert.match(text, /^# TYPE nutrikit_requests_total counter$/m);
  assert.match(text, /^nutrikit_requests_total\{route="GET \/v1\/health",status_class="2xx"\} 1$/m);
  assert.match(text, /^nutrikit_request_duration_ms\{route="GET \/v1\/health",quantile="0.95"\} [\d.]+$/m);
  assert.match(text, /^nutrikit_uptime_seconds \d+$/m);
  assert.equal((await fetch(`${base}/v1/admin/metrics?format=xml`, { headers: ADMIN })).status, 400);
});

test('alerts: an unhandled error posts once per cooldown, without request details', async () => {
  const hook = await webhook();
  const { app, base } = await start({ alertWebhookUrl: hook.url });
  const secret = 'nk_this_must_never_be_sent';
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}/test/boom?token=${secret}`, { headers: { Authorization: `Bearer ${secret}`, 'X-Request-Id': `boom-${i}` } });
    assert.equal(res.status, 500);
  }
  await app.monitor.flush();
  assert.equal(hook.received.length, 1, 'repeats within the cooldown are held back');
  const [alert] = hook.received;
  assert.equal(alert.event, 'unhandled_error');
  assert.equal(alert.text, alert.content, 'Slack reads text, Discord reads content');
  assert.match(alert.text, /Unhandled error on GET \/test\/boom/);
  assert.match(alert.text, /TypeError: cannot read properties of undefined/);
  assert.match(alert.text, /request id: boom-0/);
  assert.ok(!JSON.stringify(alert).includes(secret), 'no credentials or query strings');

  const m = await (await fetch(`${base}/v1/admin/metrics`, { headers: ADMIN })).json();
  assert.deepEqual({ configured: m.alerts.configured, sent: m.alerts.sent, suppressed: m.alerts.suppressed }, { configured: true, sent: 1, suppressed: 2 });
});

test('alerts: the next alert after the cooldown reports how many were held back', async () => {
  const hook = await webhook();
  process.env.NUTRIKIT_ALERT_COOLDOWN_S = '0.05';
  try {
    const { app, base } = await start({ alertWebhookUrl: hook.url });
    await fetch(`${base}/test/boom`);
    await fetch(`${base}/test/boom`);
    await app.monitor.flush();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await fetch(`${base}/test/boom`);
    await app.monitor.flush();
    assert.equal(hook.received.length, 2);
    assert.match(hook.received[1].text, /\(1 more since the last alert like this\)/);
  } finally {
    delete process.env.NUTRIKIT_ALERT_COOLDOWN_S;
  }
});

test('alerts: deliberate errors never alert; a burst of upstream failures does', async () => {
  const hook = await webhook();
  process.env.NUTRIKIT_ALERT_ERROR_BURST = '4';
  try {
    const { app, base } = await start({ alertWebhookUrl: hook.url });
    assert.equal((await fetch(`${base}/v1/foods/search?q=apple`)).status, 401);
    assert.equal((await fetch(`${base}/v1/nope`)).status, 404);
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/test/upstream`)).status, 502);
    await app.monitor.flush();
    assert.equal(hook.received.length, 0, '4xx and a few 502s stay quiet');

    for (let i = 0; i < 3; i++) await fetch(`${base}/test/upstream`);
    await app.monitor.flush();
    assert.equal(hook.received.length, 1, 'one burst alert, not one per error');
    assert.equal(hook.received[0].event, 'error_burst');
    assert.match(hook.received[0].text, /4 server errors in the last 5 minutes/);
    assert.match(hook.received[0].text, /latest route: GET \/test\/upstream/);
  } finally {
    delete process.env.NUTRIKIT_ALERT_ERROR_BURST;
  }
});

test('alerts: a failing webhook is counted and never breaks the request', async () => {
  const hook = await webhook({ status: 500 });
  const { app, base } = await start({ alertWebhookUrl: hook.url });
  assert.equal((await fetch(`${base}/test/boom`)).status, 500);
  await app.monitor.flush();
  assert.equal(hook.received.length, 1);
  const m = await (await fetch(`${base}/v1/admin/metrics`, { headers: ADMIN })).json();
  assert.equal(m.alerts.failed, 1);
  assert.equal(m.alerts.sent, 0);
});
