# Monitoring

Three layers, all free:

| Layer | What it tells you | Set up |
|---|---|---|
| **Alerts** | An unhandled error, a burst of server errors, or a crash, posted to Slack or Discord within seconds | `NUTRIKIT_ALERT_WEBHOOK_URL` |
| **Uptime** | The site is down or the database is unreachable | The Uptime GitHub Actions workflow, with the `UPTIME_SLACK_WEBHOOK_URL` secret |
| **Metrics** | Traffic, error rate, latency per route, memory, event-loop delay | `/admin` → **Health**, or `GET /v1/admin/metrics` |

Request logs (JSON lines on stdout, one per request, with its `requestId`) are covered in
[Configuration](configuration.md). An alert carries the request id, so you can find the matching log line.

## 1. Alerts

Create an incoming webhook and set it as `NUTRIKIT_ALERT_WEBHOOK_URL` (on Render: Environment → add the
variable; it's listed in `render.yaml`).

- **Slack:** api.slack.com/apps → Create app → Incoming Webhooks → add one for a channel.
- **Discord:** channel → Edit channel → Integrations → Webhooks → New webhook → Copy URL.
- **Anything else:** any URL that accepts a JSON `POST`. The body is
  `{ text, content, event, title, fields, at }`, where `text` and `content` hold the same message.

What sends an alert:

| Event | When |
|---|---|
| `unhandled_error` | A request ends in a 500: a bug, not a deliberate 4xx or an upstream's 502–504 |
| `error_burst` | `NUTRIKIT_ALERT_ERROR_BURST` (default 10) server errors of any kind within 5 minutes, e.g. Open Food Facts or the AI provider failing every call |
| `crash` | The process hits an uncaught exception or an unhandled rejection. It is logged and alerted, then the process exits and the platform restarts it |

The same alert (same event, route and error) is sent at most once per `NUTRIKIT_ALERT_COOLDOWN_S` (default
600 seconds). Repeats in between are counted, and the next alert says how many there were. Across all events,
at most 30 alerts are sent per hour. Alerts contain the route, status, request id, and the error's name and
message (cut to 300 characters). They never contain headers, bodies, query strings, keys or account details.

A webhook that fails or is slow (5 s deadline) never affects the request. The failure is logged as
`alert not delivered` and counted under **Alerts** in the Health tab.

## 2. Uptime

Metrics and alerts run inside the server, so they can't report that the server itself is down. A GitHub Actions
workflow, [.github/workflows/uptime.yml](../.github/workflows/uptime.yml), checks from outside instead:

- About every 5 minutes it requests `https://nutrikit.onrender.com/v1/health/ready`, trying 3 times with a 90-second
  timeout so a sleeping free Render service has time to wake. That endpoint answers 503 when the database doesn't
  respond within 2 seconds or the food catalog can't be read, so a database outage counts as down too.
- It posts to Slack only when the state changes: one ":red_circle: Nutrikit is DOWN" message when the site goes down,
  and one ":large_green_circle: back UP" message when it recovers.
- A run fails while the site is down, so the Actions tab shows the outage history.

**Set it up:** add the Slack webhook as a repository secret named `UPTIME_SLACK_WEBHOOK_URL` (GitHub → the repository →
Settings → Secrets and variables → Actions → New repository secret), or from a terminal:

```bash
gh secret set UPTIME_SLACK_WEBHOOK_URL
```

To check another address, set a repository *variable* `UPTIME_URL`. To run a check now: Actions → Uptime → Run workflow.

**Limits:** GitHub can start scheduled runs several minutes late, so an outage may be reported 5–15 minutes after it
starts. GitHub also pauses schedules in a public repository after 60 days without commits; it emails the owner, and one
click on the Actions tab turns it back on. For checks every minute from several regions, use a hosted monitor such as
[UptimeRobot](https://uptimerobot.com) or [Better Stack](https://betterstack.com/uptime) on the same URL.

**On Render's free plan,** a check every 5 minutes also stops the service from sleeping, so visitors never wait for it
to wake. That uses about 744 of the plan's 750 free instance hours a month, which leaves no room for a second free
service on the same account.

## 3. Metrics

Open `/admin`, sign in, and choose **Health**. It refreshes every 15 seconds and shows:

- uptime, requests and server-error rate for the last 5 minutes and the last hour;
- memory (RSS and heap) and event-loop delay. A p99 above about 100 ms means the instance is overloaded;
- every route with its request count, 4xx and 5xx counts, and p50, p95 and p99 latency (over its last 512
  requests);
- whether alerts are on, with counts sent, held back and failed.

The same data is available from the admin API:

```bash
curl -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" https://<host>/v1/admin/metrics
curl -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" "https://<host>/v1/admin/metrics?format=prometheus"
```

The Prometheus format works with any scraper that can send a bearer token, such as Grafana Cloud's free tier
or Grafana Alloy. It exposes `nutrikit_requests_total{route,status_class}`,
`nutrikit_request_duration_ms{route,quantile}`, `nutrikit_uptime_seconds`, `nutrikit_resident_memory_mb`,
`nutrikit_heap_used_mb`, `nutrikit_event_loop_delay_p99_ms` and `nutrikit_alerts_total{outcome}`.

**Limits:** metrics are kept in memory. Each instance reports only its own, and a restart (a deploy, or Render's
free plan waking up) starts them from zero. For history or charts across instances, scrape the Prometheus
endpoint. Usage per account and key is stored separately in Postgres and is unaffected by restarts.

## Settings

| Variable | Default | What it's for |
|---|---|---|
| `NUTRIKIT_ALERT_WEBHOOK_URL` | – | Slack or Discord incoming webhook (or any JSON endpoint). Unset: no alerts |
| `NUTRIKIT_ALERT_COOLDOWN_S` | `600` | Seconds before the same alert is sent again |
| `NUTRIKIT_ALERT_ERROR_BURST` | `10` | Server errors within 5 minutes that raise an `error_burst` alert |
