#!/bin/sh
# Starts two app containers against one fresh database on the compose Postgres, runs multi-instance.mjs,
# and removes everything it created. Needs `docker compose up -d --build --wait` (for the image and network).
set -eu
cd "$(dirname "$0")/.."
NET=$(docker inspect "$(docker compose ps -q postgres)" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
DB=nutrikit_multi_$$
URL="postgres://nutrikit:nutrikit@postgres:5432/$DB"
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
cleanup() {
  docker rm -f "nk-multi-a-$$" "nk-multi-b-$$" >/dev/null 2>&1 || true
  docker compose exec -T postgres psql -q -U nutrikit -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose exec -T postgres psql -q -U nutrikit -d postgres -c "CREATE DATABASE $DB"
docker run --rm --network "$NET" -e DATABASE_URL="$URL" nutrikit:local node dist/cli/migrate.js
docker run -d --name "nk-multi-a-$$" --network "$NET" -p 8797:8787 -e DATABASE_URL="$URL" -e NUTRIKIT_TOKEN_SECRET="$SECRET" nutrikit:local >/dev/null
docker run -d --name "nk-multi-b-$$" --network "$NET" -p 8798:8787 -e DATABASE_URL="$URL" -e NUTRIKIT_TOKEN_SECRET="$SECRET" nutrikit:local >/dev/null
for port in 8797 8798; do
  i=0; until curl -sf "http://127.0.0.1:$port/v1/health" >/dev/null; do i=$((i + 1)); [ $i -gt 50 ] && exit 1; sleep 0.2; done
done
node e2e/multi-instance.mjs
