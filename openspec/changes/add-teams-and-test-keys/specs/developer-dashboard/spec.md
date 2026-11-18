# Spec Delta

## MODIFIED Requirements

### Requirement: Key limit is explained before it is hit
When the team has as many active keys of one mode as its plan allows, creating a key of that mode SHALL be disabled
and the card SHALL say how many keys the plan allows and that one must be revoked or the plan upgraded.

#### Scenario: Free plan with two live keys
- **WHEN** a Free team has 2 active live keys
- **THEN** creating a live key is disabled with the limit explained, and creating a test key is still possible

## ADDED Requirements

### Requirement: Team switcher and members card
The dashboard SHALL show the team in use with a switcher listing the user's teams and an option to create a team. A
members card SHALL list members (name, email, role) and pending invitations, and SHALL offer invite, change role,
remove, revoke invitation and leave only to the roles allowed to use them.

#### Scenario: Developer views members
- **WHEN** a developer opens the dashboard
- **THEN** they see the members list without invite, role or remove controls, and with a "Leave team" button

### Requirement: Keys show their mode and creator
The keys card SHALL show each key's mode (live or test) and who created it, and SHALL offer to create live keys only
to owners and admins. Live usage figures SHALL exclude test keys, and the test allowance SHALL be shown separately.

#### Scenario: Test key created
- **WHEN** a member creates a test key
- **THEN** it is listed with a "Test" badge and their name, and the live usage figures are unchanged
