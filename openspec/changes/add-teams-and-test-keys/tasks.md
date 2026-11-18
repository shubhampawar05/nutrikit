# Tasks

## 1. Data

- [x] 1.1 Migration `006_teams.sql`: users, memberships, invitations; move login data out of accounts; sessions and email links point at users; keys get `mode` and `created_by`; verify by migrating a database with existing accounts, sessions and keys, and running the down migration
- [x] 1.2 Plans gain `maxMembers`

## 2. Server

- [x] 2.1 `accounts.ts`: users (signup, login, reset, verify, delete) and teams (create, get, session team with fallback)
- [x] 2.2 `teams.ts`: memberships, roles, invitations (email), member limit, last-owner rule
- [x] 2.3 `auth.ts`: key modes and prefixes, test allowance and rate, live-only usage figures, `created_by`
- [x] 2.4 Sample AI provider; test-mode routing in `v1.ts`; `X-Nutrikit-Mode` header in metering
- [x] 2.5 Portal routes for teams, members, invitations and key modes, with role checks
- [x] 2.6 Admin read models: teams with owners and member counts, key mode
- [x] 2.7 Tests: migration, roles, invitations, last owner, switching, deletion, test-key metering and sample AI

## 3. Web

- [x] 3.1 Dashboard: team switcher, create team, members card, live/test keys with creator, test allowance
- [x] 3.2 Invite page (`/invite?token=`), signup/login carry the invitation through
- [x] 3.3 Admin console columns
- [x] 3.4 Component tests

## 4. SDK, MCP, docs

- [x] 4.1 SDK and MCP docs mention `nk_live_`/`nk_test_` and test mode
- [x] 4.2 `docs/platform.md`, `docs/api.md`, website docs, `docs/configuration.md` (new env vars)
- [x] 4.3 Verify in the browser: sign up, invite a second user, accept, create a test key, call the API with it
