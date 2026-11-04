# portal-auth Specification

## Purpose
Covers how developers create accounts, log in and keep a browser session in the developer portal, and how those
entry points are protected against automated abuse such as account farming, credential stuffing and lockouts.

## Requirements

### Requirement: Signup
A visitor SHALL be able to create an account with a name (1–100 characters), a valid email (unique,
case-insensitive) and a password of 10–200 characters. A successful signup SHALL start a session and return the
account and its first API key, shown once.

#### Scenario: New developer signs up
- **WHEN** a visitor submits a valid name, email and password
- **THEN** the server answers 201 with the account on the Free plan, a first key, and a session cookie

#### Scenario: Email already registered
- **WHEN** a visitor signs up with an email that differs from an existing account's only in letter case
- **THEN** the server answers 409 `email_taken` and creates nothing

### Requirement: Signup throttled per client address
Signups SHALL be limited per client address to a configurable count per hour (default 5). Over the limit, signup
SHALL answer `429 too_many_signups` with `Retry-After` and create nothing. Attempts rejected for invalid fields
SHALL also count.

#### Scenario: Scripted account farming
- **WHEN** one client address submits a sixth signup within an hour
- **THEN** the server answers 429 `too_many_signups` with `Retry-After`, and no account or key is created

#### Scenario: Different addresses
- **WHEN** two different client addresses each sign up five times in an hour
- **THEN** all ten signups succeed

### Requirement: Login throttled per email and per client address
Failed logins SHALL be limited to 5 per 15 minutes per email and to a configurable count (default 20) per 15
minutes per client address. Over either limit, login SHALL answer `429 too_many_attempts` with `Retry-After`,
whether or not the password is correct.

#### Scenario: Credential stuffing across many emails
- **WHEN** one client address fails 20 logins for 20 different emails within 15 minutes
- **THEN** its next login attempt for any email answers 429 `too_many_attempts`

#### Scenario: Repeated failures for one email
- **WHEN** an email has 5 failed logins within 15 minutes
- **THEN** the next attempt for that email answers 429 `too_many_attempts` with `Retry-After`

### Requirement: Login does not reveal which emails exist
A login with an unknown email and a login with a known email and wrong password SHALL return the same response,
`401 invalid_credentials`, and take comparable time.

#### Scenario: Unknown email
- **WHEN** a visitor logs in with an email that has no account
- **THEN** the server answers 401 `invalid_credentials`, the same as for a wrong password

### Requirement: Password hashing does not block other requests
Password hashing and verification SHALL NOT block the server from answering other requests while it runs.
Accounts created before this change SHALL still log in with their existing passwords.

#### Scenario: Logins during API traffic
- **WHEN** many logins are processed at the same time as /v1 calls
- **THEN** /v1 calls on the same instance keep answering without waiting for the hashing to finish

#### Scenario: Existing account
- **WHEN** a developer whose password was stored before this change logs in with the correct password
- **THEN** the login succeeds

### Requirement: Session cookie
A session SHALL be carried in an HttpOnly, SameSite=Lax cookie that is also Secure when secure cookies are
enabled. It SHALL last 14 days and end at logout. State-changing portal calls SHALL require the
`X-Nutrikit-Portal: 1` header and SHALL answer `403 csrf` without it.

#### Scenario: Cross-site form post
- **WHEN** another site submits a form to a portal endpoint using the developer's cookie
- **THEN** the server answers 403 `csrf` and changes nothing

#### Scenario: Logout
- **WHEN** a signed-in developer logs out
- **THEN** the session stops working immediately and the cookie is cleared
