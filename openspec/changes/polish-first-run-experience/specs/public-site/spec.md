# Spec Delta

## Purpose

What a visitor sees before signing up: the home page and its live demo, the pricing page and the documentation,
which must be accurate, consistent with the API, and free of internal notes.

## ADDED Requirements

### Requirement: Pricing shows the server's plans and no internal notes
The pricing page SHALL show the plans the server actually sells, read from a public endpoint that needs no sign-in,
and SHALL NOT show notes meant for the operator or developers of Nutrikit.

#### Scenario: Visitor opens pricing
- **WHEN** a signed-out visitor opens /pricing
- **THEN** the plans, prices, allowances, rate limits and key limits match the server's plans, and no "placeholder" note is shown

#### Scenario: Plans endpoint
- **WHEN** anyone calls `GET /portal/api/plans`
- **THEN** it answers 200 with each plan's name, price, currency, monthly tokens, rate per minute and key limit, and nothing else

### Requirement: Copy matches the API
The pricing page, documentation and home page SHALL describe the API as it behaves. That covers token charging
(failed AI calls may be charged), which responses carry `X-Tokens-Charged`, every documented error code including
`504 ai_timeout`, the data sources and the changelog. No AI vendor SHALL be named unless it is the one the server
uses.

#### Scenario: Failed requests
- **WHEN** a visitor reads "Do failed requests cost tokens?" or the docs' token section
- **THEN** it says failed calls are free except AI usage the provider already consumed, shown in `X-Tokens-Charged`

#### Scenario: Errors table
- **WHEN** a developer reads the docs' errors table
- **THEN** it lists `504 ai_timeout` with what to do

#### Scenario: Changelog
- **WHEN** a developer reads the changelog
- **THEN** it has an entry for request ids, readiness checks, atomic allowances, failed-call charging and AI timeouts

### Requirement: Calls to action go where they say
Every call to action SHALL go to the page it names. Code samples SHALL use the address of the server the visitor is on.

#### Scenario: Enterprise
- **WHEN** a visitor clicks the Enterprise call to action
- **THEN** it says what will happen (contact or request) and leads there: signup for visitors, the dashboard upgrade form for signed-in developers

#### Scenario: Home code sample
- **WHEN** a visitor reads the home page's curl sample
- **THEN** it uses this server's address, not `api.your-domain.com`

### Requirement: The home demo is gentle with its limit
The demo SHALL send a request when the visitor submits or picks an example, or after they stop typing for at least
1.5 seconds. It SHALL show a busy state while a request runs. After an error it SHALL clear the previous meal's
numbers. When the demo limit is reached, it SHALL say so in sentence case with a link to sign up.

#### Scenario: Typing a sentence
- **WHEN** a visitor types a ten-word meal at a normal pace
- **THEN** at most one demo request is sent once they stop

#### Scenario: Limit reached
- **WHEN** the demo answers `429 rate_limited`
- **THEN** the label shows no previous numbers, and the message links "create a free key" to /signup

### Requirement: Auth forms are clear
The signup form SHALL state the password rule once. "This email is already registered" SHALL link to log in with the
email filled in. Switching between log in and sign up SHALL keep the page the visitor was headed to.

#### Scenario: Password hint
- **WHEN** a visitor submits a short password
- **THEN** the rule appears once, as the field error

#### Scenario: Next page kept
- **WHEN** a visitor at /login?next=/playground clicks "Create an account" and signs up
- **THEN** they land on /playground
