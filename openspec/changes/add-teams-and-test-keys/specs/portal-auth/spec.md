# Spec Delta

## MODIFIED Requirements

### Requirement: Signup
A visitor SHALL be able to create a user with a name (1–100 characters), a valid email (unique,
case-insensitive) and a password of 10–200 characters. A successful signup SHALL create a team named after the
user, on the Free plan, with the user as its owner, start a session in that team and return the team and its first
live API key, shown once.

#### Scenario: New developer signs up
- **WHEN** a visitor submits a valid name, email and password
- **THEN** the server answers 201 with the user, a team on the Free plan that they own, a first live key, and a session cookie

#### Scenario: Email already registered
- **WHEN** a visitor signs up with an email that differs from an existing user's only in letter case
- **THEN** the server answers 409 `email_taken` and creates nothing

## ADDED Requirements

### Requirement: Existing accounts keep working
Accounts created before teams SHALL become a team owned by their person, with the same email, password, keys,
plan, usage and payments. Existing sessions and API keys SHALL keep working without any action.

#### Scenario: Developer signed in before the upgrade
- **WHEN** a developer who had a session and a key before the migration opens the dashboard and calls the API
- **THEN** the dashboard shows their team with them as owner, and the key is accepted as a live key

### Requirement: Deleting a user respects team ownership
Deleting a user SHALL also delete every team in which they are the only member. It SHALL be refused with
`409 sole_owner`, naming the teams, while they are the only owner of a team that has other members.

#### Scenario: Founder with a team
- **WHEN** the only owner of a team with two developers asks to delete their account
- **THEN** the server answers 409 `sole_owner` naming that team, and nothing is deleted
