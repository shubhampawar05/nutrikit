// Monitoring: request metrics kept in this process, and alerts posted to a chat webhook.
//
// Metrics: per-route counts by status class and recent latencies (p50/p95/p99), requests and server errors per
// minute for the last hour, memory and event-loop delay. Read them at GET /v1/admin/metrics (JSON, or Prometheus
// text with ?format=prometheus). They live in memory: each instance reports its own, and a restart clears them.
//
// Alerts (NUTRIKIT_ALERT_WEBHOOK_URL, a Slack or Discord incoming webhook, or any URL that takes JSON):
//   - an unhandled error (a 500, never a deliberate 4xx or an upstream 502-504);
//   - a burst of server errors (NUTRIKIT_ALERT_ERROR_BURST 5xx responses within 5 minutes, default 10), which also
//     catches an upstream outage such as Open Food Facts or the AI provider failing every call;
//   - the process crashing (main.ts).
// The same alert is sent at most once per NUTRIKIT_ALERT_COOLDOWN_S (default 600); repeats in between are counted
// and reported with the next one. At most 30 alerts an hour in all. Alerts carry the route, status, request id and
// the error's name and message: never headers, bodies, credentials or account details.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';

export interface MonitoringOptions {
  /** Where alerts go (default: NUTRIKIT_ALERT_WEBHOOK_URL). Without one, nothing is sent. */
  alertWebhookUrl?: string;
}

/** A failure the server did not mean to return: a 500, as opposed to 501 or an upstream's 502-504. */
export const isUnhandled = (status: number) => status >= 500 && ![501, 502, 503, 504].includes(status);

const SAMPLES = 512; // latencies kept per route
const BURST_WINDOW_MS = 5 * 60_000;
const MAX_ALERTS_PER_HOUR = 30;
const ALERT_TIMEOUT_MS = 5_000;
const MAX_TEXT = 300;

const envNumber = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
const ms = (n: number) => Math.round(n * 10) / 10;

type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';
const classOf = (status: number): StatusClass => (status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx');

interface RouteStats {
  byClass: Record<StatusClass, number>;
  samples: Float64Array;
  filled: number;
  next: number;
}

function percentile(sorted: Float64Array, p: number) {
  if (!sorted.length) return null;
  return ms(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!);
}

export interface AlertFields { [name: string]: string | number | null | undefined }

export class Monitor {
  readonly startedAt = new Date();
  private routes = new Map<string, RouteStats>();
  private minutes = new Map<number, { requests: number; serverErrors: number }>();
  private serverErrorTimes: number[] = [];
  private loop = monitorEventLoopDelay({ resolution: 20 });
  private lastAlert = new Map<string, { at: number; suppressed: number }>();
  private alertTimes: number[] = [];
  private pending = new Set<Promise<void>>();
  readonly alerts = { sent: 0, failed: 0, suppressed: 0, lastSentAt: null as string | null };

  private webhookUrl: string | undefined;
  private log: FastifyBaseLogger;

  constructor(webhookUrl: string | undefined, log: FastifyBaseLogger) {
    this.webhookUrl = webhookUrl || undefined;
    this.log = log;
    this.loop.enable();
  }

  get alertsConfigured() { return Boolean(this.webhookUrl); }

  /** Counts one finished request. */
  record(route: string, status: number, durationMs: number, now = Date.now()) {
    let stats = this.routes.get(route);
    if (!stats) {
      stats = { byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }, samples: new Float64Array(SAMPLES), filled: 0, next: 0 };
      this.routes.set(route, stats);
    }
    const cls = classOf(status);
    stats.byClass[cls]++;
    stats.samples[stats.next] = durationMs;
    stats.next = (stats.next + 1) % SAMPLES;
    stats.filled = Math.min(SAMPLES, stats.filled + 1);

    const minute = Math.floor(now / 60_000);
    const bucket = this.minutes.get(minute) ?? { requests: 0, serverErrors: 0 };
    bucket.requests++;
    if (cls === '5xx') bucket.serverErrors++;
    this.minutes.set(minute, bucket);
    for (const m of this.minutes.keys()) if (m <= minute - 60) this.minutes.delete(m);

    if (cls === '5xx') {
      this.serverErrorTimes.push(now);
      while (this.serverErrorTimes.length && this.serverErrorTimes[0]! <= now - BURST_WINDOW_MS) this.serverErrorTimes.shift();
      const burst = envNumber('NUTRIKIT_ALERT_ERROR_BURST', 10);
      if (this.serverErrorTimes.length >= burst) {
        this.alert('error_burst', `${this.serverErrorTimes.length} server errors in the last 5 minutes`, { 'latest route': route, 'latest status': status }, 'error_burst');
      }
    }
  }

  /**
   * Posts an alert unless the same `key` was sent within the cooldown or the hourly cap is reached. Never throws;
   * resolves once the webhook answered (or failed).
   */
  alert(event: string, title: string, fields: AlertFields = {}, key = `${event}:${title}`): Promise<void> {
    if (!this.webhookUrl) return Promise.resolve();
    const now = Date.now();
    const cooldownMs = envNumber('NUTRIKIT_ALERT_COOLDOWN_S', 600) * 1000;
    const last = this.lastAlert.get(key);
    while (this.alertTimes.length && this.alertTimes[0]! <= now - 3_600_000) this.alertTimes.shift();
    if ((last && now - last.at < cooldownMs) || this.alertTimes.length >= MAX_ALERTS_PER_HOUR) {
      if (last) last.suppressed++;
      this.alerts.suppressed++;
      return Promise.resolve();
    }
    const repeats = last?.suppressed ?? 0;
    this.lastAlert.set(key, { at: now, suppressed: 0 });
    this.alertTimes.push(now);

    const where = process.env.NUTRIKIT_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'nutrikit';
    const lines = [`[${where}] ${clip(title)}`];
    for (const [name, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== '') lines.push(`${name}: ${clip(String(value))}`);
    if (repeats) lines.push(`(${repeats} more since the last alert like this)`);
    const text = lines.join('\n');

    const sending = fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` for Slack, `content` for Discord; generic receivers can read `event` and `fields`.
      body: JSON.stringify({ text, content: text, event, title: clip(title), fields, at: new Date(now).toISOString() }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    }).then(
      (res) => {
        if (!res.ok) throw new Error(`webhook answered ${res.status}`);
        this.alerts.sent++;
        this.alerts.lastSentAt = new Date().toISOString();
      },
    ).catch((err: Error) => {
      this.alerts.failed++;
      this.log.warn({ event, detail: err.message }, 'alert not delivered');
    }).finally(() => { this.pending.delete(sending); });
    this.pending.add(sending);
    return sending;
  }

  /** Waits for alerts still being sent (tests; shutdown). */
  async flush() { await Promise.all([...this.pending]); }

  close() { this.loop.disable(); }

  snapshot() {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    let last5 = { requests: 0, serverErrors: 0 };
    let last60 = { requests: 0, serverErrors: 0 };
    for (const [m, b] of this.minutes) {
      if (m > minute - 60) last60 = { requests: last60.requests + b.requests, serverErrors: last60.serverErrors + b.serverErrors };
      if (m > minute - 5) last5 = { requests: last5.requests + b.requests, serverErrors: last5.serverErrors + b.serverErrors };
    }
    const totals: Record<StatusClass, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    const routes = [...this.routes].map(([route, s]) => {
      const sorted = s.samples.slice(0, s.filled).sort();
      const count = s.byClass['2xx'] + s.byClass['3xx'] + s.byClass['4xx'] + s.byClass['5xx'];
      for (const c of Object.keys(totals) as StatusClass[]) totals[c] += s.byClass[c];
      return { route, count, byStatus: { ...s.byClass }, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), p99Ms: percentile(sorted, 0.99) };
    }).sort((a, b) => b.count - a.count);
    const memory = process.memoryUsage();
    const delay = (n: number) => (Number.isFinite(n) ? ms(n / 1e6) : null);
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round((now - this.startedAt.getTime()) / 1000),
      process: {
        rssMb: mb(memory.rss),
        heapUsedMb: mb(memory.heapUsed),
        eventLoopDelayMs: { p50: delay(this.loop.percentile(50)), p99: delay(this.loop.percentile(99)), max: delay(this.loop.max) },
        node: process.version,
      },
      requests: { total: totals['2xx'] + totals['3xx'] + totals['4xx'] + totals['5xx'], byStatus: totals, last5Minutes: last5, last60Minutes: last60 },
      routes,
      alerts: { configured: this.alertsConfigured, ...this.alerts },
    };
  }

  /** The snapshot in the Prometheus text format (version 0.0.4). */
  prometheus() {
    const s = this.snapshot();
    const label = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const out: string[] = [];
    const metric = (name: string, type: string, help: string, rows: [string, number | null][]) => {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, value] of rows) if (value !== null) out.push(`${name}${labels} ${value}`);
    };
    metric('nutrikit_requests_total', 'counter', 'Requests by route and status class since start.',
      s.routes.flatMap((r) => (Object.entries(r.byStatus) as [string, number][]).filter(([, n]) => n).map(([c, n]) => [`{route="${label(r.route)}",status_class="${c}"}`, n] as [string, number])));
    metric('nutrikit_request_duration_ms', 'summary', `Latency over the last ${SAMPLES} requests per route.`,
      s.routes.flatMap((r) => [['0.5', r.p50Ms], ['0.95', r.p95Ms], ['0.99', r.p99Ms]].map(([q, v]) => [`{route="${label(r.route)}",quantile="${q}"}`, v as number | null] as [string, number | null])));
    metric('nutrikit_uptime_seconds', 'gauge', 'Seconds since this process started.', [['', s.uptimeSeconds]]);
    metric('nutrikit_resident_memory_mb', 'gauge', 'Resident set size in MB.', [['', s.process.rssMb]]);
    metric('nutrikit_heap_used_mb', 'gauge', 'V8 heap in use in MB.', [['', s.process.heapUsedMb]]);
    metric('nutrikit_event_loop_delay_p99_ms', 'gauge', 'Event-loop delay, 99th percentile.', [['', s.process.eventLoopDelayMs.p99]]);
    metric('nutrikit_alerts_total', 'counter', 'Alerts by outcome since start.',
      [['{outcome="sent"}', s.alerts.sent], ['{outcome="failed"}', s.alerts.failed], ['{outcome="suppressed"}', s.alerts.suppressed]]);
    return `${out.join('\n')}\n`;
  }
}

/** Adds `app.monitor` and counts every response. Unhandled errors alert through alertUnhandled (errors.ts). */
export function monitoring(app: FastifyInstance, opts: MonitoringOptions = {}) {
  const monitor = new Monitor(opts.alertWebhookUrl ?? process.env.NUTRIKIT_ALERT_WEBHOOK_URL, app.log);
  app.decorate('monitor', monitor);
  app.addHook('onClose', async () => { await monitor.flush(); monitor.close(); });

  app.addHook('onResponse', async (req, reply) => {
    monitor.record(`${req.method} ${req.routeOptions.url ?? '(no route)'}`, reply.statusCode, reply.elapsedTime);
  });
}

/** Alerts on an unhandled error (called by the error handler, which knows the final status). */
export function alertUnhandled(monitor: Monitor, req: FastifyRequest, status: number, err: Error) {
  const route = `${req.method} ${req.routeOptions.url ?? '(no route)'}`;
  void monitor.alert('unhandled_error', `Unhandled error on ${route}`, {
    error: `${err.name}: ${err.message}`,
    status,
    'request id': req.id,
  }, `unhandled_error:${route}:${err.name}:${err.message}`);
}
