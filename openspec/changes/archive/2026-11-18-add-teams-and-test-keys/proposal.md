# Proposal

## Why

Nutrikit is sold to businesses, but today a login *is* the account: the plan, the API keys and the usage all belong
to one person's email and password. A company can't add its engineers, can't keep its keys working when the person
who signed up leaves, and has no safe way to build and run CI without spending its production allowance. Every
serious API (Stripe, Twilio, Passio) has teams and separate test and live keys, and B2B buyers expect both before
they integrate.

## What Changes

- **People and teams are separate.** A *user* (email, name, password) signs in. A *team* (the existing `accounts`
  row: name, plan, keys, usage, payments) is what the API bills. A user belongs to one or more teams through a
  *membership* with a role. Signup creates a user, a team named after them, and makes them its owner. Existing
  accounts are migrated: each becomes a team with its person as owner, and every key and session keeps working.
- **Roles.** `owner` (everything, including roles of other owners and the plan), `admin` (members except owners, all
  keys) and `developer` (sees keys and usage, manages test keys only). A team always has at least one owner.
- **Invitations.** Owners and admins invite people by email with a role. The emailed link works for 7 days and only
  for a signed-in user with that email; someone without a user signs up first. Pending invites can be revoked. A
  team's size is capped by its plan (`maxMembers`).
- **Members can be managed.** Change role, remove a member, leave a team. The last owner can't leave or be demoted.
- **Several teams per user.** The dashboard has a team switcher and "Create team". The session remembers the team
  in use.
- **Test and live keys.** New keys are `nk_live_…` or `nk_test_…`; keys made before this change stay live. Test
  keys:
  - count against a separate monthly test allowance (default 5,000 tokens, `NUTRIKIT_TEST_TOKENS`) and a lower rate
    limit (default 30/min, `NUTRIKIT_TEST_RATE_LIMIT`), never against the team's plan;
  - get real catalog answers (search, foods, portions, text logging, barcodes, meal plans);
  - never call the AI provider: photo, label-photo, AI text and advisor calls return fixed sample answers
    (`provider: "test"`), so CI is free and deterministic;
  - carry `X-Nutrikit-Mode: test` on every response.
  The plan's key limit applies to live and test keys separately.
- **Keys record who made them** (`created_by`), shown in the dashboard; they stay when that person leaves.
- **Account deletion** deletes the user. Teams where they are the only member are deleted with them; deleting is
  refused while they are the only owner of a team that has other members.
- **Admin console** shows teams with their owners and member count, and each key's mode.

**Out of scope:** paid plans stay hidden (no billing change); SSO/SAML, audit logs, per-key permissions, deleting
a team on its own (only via its last member's account deletion), and transferring payments between teams.

## Capabilities

### New Capabilities

- `teams`: users, teams, memberships, roles, invitations and the team in use.

### Modified Capabilities

- `portal-auth`: signup creates a user and a team; sessions belong to users; deletion follows team ownership.
- `api-metering`: test keys, their separate allowance and rate, and sample AI answers.
- `developer-dashboard`: team switcher, members card, live/test keys.

## Impact

- Migration `006_teams.sql` (users, memberships, invitations; sessions and email links move to users; keys get
  `mode` and `created_by`).
- Server: `domain/accounts.ts` (users, teams), new `domain/teams.ts`, `domain/auth.ts`, `plugins/metering.ts`,
  `routes/portal.ts`, `routes/v1.ts`, `domain/admin.ts`, new `domain/providers/sample.ts`.
- Web: dashboard, auth pages, a new invite page, admin console.
- SDK, MCP and docs: key prefixes and test mode.
