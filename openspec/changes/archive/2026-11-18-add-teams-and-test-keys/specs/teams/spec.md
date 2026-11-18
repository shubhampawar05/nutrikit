# Spec Delta

## ADDED Requirements

### Requirement: Teams own keys, plans and usage
API keys, the plan, the monthly allowance, usage and payments SHALL belong to a team, not to a person. A user SHALL
be able to belong to several teams, each through one membership with a role of `owner`, `admin` or `developer`.
Removing a person from a team SHALL NOT revoke or change any of the team's keys.

#### Scenario: Engineer leaves
- **WHEN** an owner removes the developer who created the team's live key
- **THEN** the key keeps working and still counts against the team's allowance

### Requirement: Roles limit what members can do
Owners SHALL be able to do everything. Admins SHALL manage live and test keys and invite, remove and change the role
of admins and developers, but SHALL NOT change or remove owners, rename the team or change its plan. Developers SHALL
see keys, usage and members, and SHALL manage test keys only. A forbidden action SHALL answer `403 forbidden`.

#### Scenario: Developer creates a live key
- **WHEN** a developer asks to create a live key
- **THEN** the server answers 403 `forbidden` and no key is created

#### Scenario: Developer creates a test key
- **WHEN** a developer asks to create a test key
- **THEN** the key is created and shown once

### Requirement: A team always has an owner
The last owner of a team SHALL NOT be able to leave, be removed or be demoted; such a request SHALL answer
`409 last_owner`.

#### Scenario: Sole owner tries to leave
- **WHEN** the only owner of a team with other members asks to leave it
- **THEN** the server answers 409 `last_owner` and nothing changes

### Requirement: Invitations by email
Owners and admins SHALL invite people by email with the role `admin` or `developer`. The invitation link SHALL work once, for 7 days, and only for a signed-in
user whose email matches it case-insensitively; another user SHALL get `403 wrong_email`. Accepting SHALL add the
membership, mark the user's email verified and make the team the one in use. A team SHALL NOT exceed its plan's
member limit, counting pending invitations when sending. Inviting a current member SHALL answer
`409 already_member`; inviting an email again SHALL replace the earlier unused invitation.

#### Scenario: Invitee without a Nutrikit login
- **WHEN** a person opens an invitation link before having a login
- **THEN** the page names the team and role and offers to sign up with the invited email, and after signing up they can accept

#### Scenario: Link forwarded to someone else
- **WHEN** a signed-in user whose email differs from the invitation's tries to accept it
- **THEN** the server answers 403 `wrong_email` and no membership is created

#### Scenario: Team is full
- **WHEN** a team with as many members and pending invitations as its plan allows sends another invitation
- **THEN** the server answers 403 `member_limit`

### Requirement: Switching teams
A signed-in user SHALL work in one team at a time, chosen from the teams they belong to, and SHALL be able to create
a new team, which they own. When the team in use is no longer theirs, the session SHALL fall back to another of
their teams, or to a new team named after them when they have none.

#### Scenario: Removed while signed in
- **WHEN** a user is removed from the team they are viewing
- **THEN** their next portal request is answered for another of their teams, never for the team they left
