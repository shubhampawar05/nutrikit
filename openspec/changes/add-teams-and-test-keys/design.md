# Design

## Data model

The `accounts` table already owns everything billing touches (plan, keys, `usage`, `usage_periods` `acct:` subjects,
payments, upgrade requests). It stays and becomes the **team**, so metering and billing don't move. What belonged to a
person moves out:

```
users        id usr_…, email citext UNIQUE, name, password_hash, email_verified_at, created_at
memberships  (account_id, user_id) PK, role owner|admin|developer, created_at
invitations  id_hash PK (SHA-256 of the link token), account_id, email, role admin|developer,
             invited_by → users, expires_at, accepted_at, created_at
sessions     + user_id NOT NULL → users;  account_id = the team in use (nullable, ON DELETE SET NULL)
email_tokens account_id → user_id
api_keys     + mode live|test (default live), + created_by → users ON DELETE SET NULL
accounts     − email, password_hash, email_verified_at
```

Migration: each account gets a user with the same email, name, password hash and verification time
(`usr_<same hex>`), an owner membership, and its sessions and email links are pointed at that user. Keys stay on
the account, so every existing key keeps working, and existing keys are live.

The team in use is stored on the session. When it is missing or the user is no longer a member (removed, team
deleted), the session falls back to the user's oldest membership; a user with no team at all gets a new one named
after them, so every signed-in request has a team.

## Roles

| Action | owner | admin | developer |
|---|---|---|---|
| See keys, usage, members | ✓ | ✓ | ✓ |
| Create/revoke/regenerate test keys | ✓ | ✓ | ✓ |
| Create/revoke/regenerate live keys | ✓ | ✓ | |
| Invite, remove, change role of admins and developers | ✓ | ✓ | |
| Make or demote owners, remove owners | ✓ | | |
| Rename the team, request upgrades, pay | ✓ | | |

The last owner can't be demoted, removed or leave (`409 last_owner`).

## Invitations

A random token is emailed as `/invite?token=…`; only its hash is stored. `GET /portal/api/invitations/:token`
(public) returns the team name, inviter name, role and email so the page can say what is on offer. Accepting
(`POST …/accept`, signed in) requires the session's email to equal the invitation's, case-insensitively, else
`403 wrong_email`. Accepting marks the user's email verified (the link reached it), switches the session to the
team, and is refused when the team is at `maxMembers` (pending invitations count toward the limit when sending, so
an admin can't over-invite). Re-inviting the same email replaces the earlier unused invitation. Inviting an
existing member answers `409 already_member`. Invitation emails share the per-network email throttle.

## Test keys

`createKey` takes `mode`; keys are `nk_live_<32 bytes>` / `nk_test_<32 bytes>`. Lookup is by hash, so old `nk_…`
keys keep working unchanged.

`KeyContext` gains `mode`. In test mode:

- **Allowance subject** `test:<account id>` with `NUTRIKIT_TEST_TOKENS` (default 5,000) per month; rate bucket
  `test:<account id>` at `NUTRIKIT_TEST_RATE_LIMIT` (default 30/min). Operator test keys use `test-key:<id>`.
- **AI:** `requireProvider` returns the built-in sample provider (`domain/providers/sample.ts`): fixed meal
  recognition (dal, rice, roti), a fixed label, the rule-based parser for AI text, and a fixed advisor answer, all
  with zero usage. Results still go through the catalog matching, so the response shape is the real one.
- **Header** `X-Nutrikit-Mode: test` on every test-mode response (set in the metering hook).
- `usage` rows record `key_id`; test usage is told apart by joining the key's mode, so live usage figures (dashboard,
  admin "tokens this month") exclude test keys.

## Portal API (new or changed)

```
GET  /portal/api/me                         + user, team, role, teams[]
POST /portal/api/teams                      create a team (you become owner) and switch to it
POST /portal/api/teams/switch {accountId}
PATCH /portal/api/team {name}               owner
GET  /portal/api/members                    members + pending invitations
POST /portal/api/invitations {email, role}  owner/admin
DELETE /portal/api/invitations/:id          owner/admin (id = first 12 hex of the hash, shown in the list)
GET  /portal/api/invitations/:token         public preview
POST /portal/api/invitations/:token/accept
PATCH /portal/api/members/:userId {role}
DELETE /portal/api/members/:userId          remove (or leave, when it is you)
POST /portal/api/keys {name, mode}          mode defaults to live
```

## Alternatives considered

- **Keep `accounts` as the person and add a `teams` table.** Every billing, metering and admin query would move to
  `team_id`; the chosen split moves only login data.
- **Test keys return fake data everywhere (Stripe-style).** Catalog answers cost us nothing and fake food data would
  make test integrations misleading; only AI calls cost money, so only they are faked.
- **Test usage counts against the plan.** Defeats the purpose: CI would eat the production allowance.
