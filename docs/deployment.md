# Deployment

Nutrikit is **one Docker image** (website, portal and API on port 8787, food catalog included) plus a
**PostgreSQL 16+ database**. Any host that runs a container works.

## Free option: Render + Supabase

| Part | Service | Free-tier limit |
|---|---|---|
| App | Render web service | Sleeps after 15 min idle; wakes in about a minute |
| Database | Supabase | 500 MB; pauses after 7 days idle (resume from its dashboard) |

> Pick the **same part of the world** for both: Render's region is set in [render.yaml](../render.yaml)
> (`singapore`, `frankfurt`, `oregon`, `ohio`, `virginia`). Every query crosses between them.

### 1. Create the database

1. Create a Supabase project.
2. Open **Connect → Session pooler** (port **5432**) and copy the connection string.
3. Fix it up:
   - If your password contains `@`, `#`, `/` or `:`, replace them with `%40`, `%23`, `%2F`, `%3A`.
   - Add `?sslmode=require` to the end.

```
postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Don't use the *direct connection* (IPv6 only) or the *transaction pooler* on port 6543 (it breaks prepared statements).

### 2. Prepare the secrets

```bash
openssl rand -hex 32   # NUTRIKIT_TOKEN_SECRET (never change it later)
openssl rand -hex 32   # NUTRIKIT_ADMIN_TOKEN  (your /admin password)
```

### 3. Create the Render service

Render dashboard → **New → Blueprint** → pick this repository. It reads [render.yaml](../render.yaml) and asks for:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The string from step 1 |
| `NUTRIKIT_TOKEN_SECRET`, `NUTRIKIT_ADMIN_TOKEN` | The values from step 2 |
| `OPENAI_API_KEY` | Optional: photo and label features |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Optional: leave empty to run without payments |

Variables marked `sync: false` in `render.yaml` are typed in the dashboard, never stored in git, and never
overwritten by later deploys. Change them later in the service's **Environment** tab.

### 4. Check it

- `https://<service>.onrender.com/v1/health` returns `"status":"ok"`.
- Sign up on the site, create an API key, try a search in the playground.
- Sign in at `/admin` with your admin token.

Every push to `main` deploys automatically. Each start applies pending migrations first.

### 5. Payments (optional)

In Razorpay, add a webhook to `https://<service>.onrender.com/webhooks/razorpay` for `order.paid`, and put
its secret in `RAZORPAY_WEBHOOK_SECRET`. See [Payments](payments.md).

## Any other host (Fly.io, Railway, a VM)

```bash
docker build -f docker/Dockerfile -t nutrikit .

# 1. Migrate once per release, before new instances take traffic
docker run --rm -e DATABASE_URL=… nutrikit node dist/cli/migrate.js

# 2. Start
docker run -d -p 8787:8787 -e DATABASE_URL=… -e NUTRIKIT_TOKEN_SECRET=… nutrikit
```

- Make step 1 the platform's *release* or *pre-deploy* command.
- You can run several instances: rate limits, login throttling and sessions are shared through Postgres.
- Create a key inside the container with `node dist/cli/create-key.js "my app"`.
- Try the image locally with `docker compose up -d --build` (http://localhost:8787).

**About the image:** about 75 MB compressed, runs as the unprivileged `node` user, with a health check on
`/v1/health`. The food catalog `server/data/foods.db` is in git; rebuild it with `npm run build:db` only when the
USDA data changes.

## Rollback

Redeploy the previous image. Migrations only add things within a release. To undo a release's migration, run
`node dist/cli/migrate.js down` from the **new** image, then deploy the old one.

## Moving from the old SQLite version

Point `DATABASE_URL` at an empty database and run `npm run migrate:sqlite -- path/to/app.db` before the
first start. It copies every table in one transaction, refuses to write into tables that already have rows,
and never modifies the SQLite file.

## TLS note

`sslmode=require` encrypts the connection but doesn't verify the certificate. For full verification use
`sslmode=verify-full` and give Node the provider's CA through `NODE_EXTRA_CA_CERTS`.
