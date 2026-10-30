# Spec Delta

## Purpose
Self-serve paid plans for developer accounts: one-time Razorpay payments in INR that unlock a plan for 30 days,
applied after a verified payment, and a request-based fallback where online payment is not set up.

## ADDED Requirements

### Requirement: Billing availability
The portal SHALL report whether online payment is available, in which mode (test or live), the currency, and the
public key the browser needs to open Razorpay Checkout. Without Razorpay credentials billing SHALL be reported as
disabled, and no secret SHALL ever be returned.

#### Scenario: Test keys configured
- **WHEN** the server has a Razorpay key id starting with `rzp_test_` and its secret, and a signed-in developer loads their account
- **THEN** billing is reported as enabled, mode `test`, currency `INR`, with the key id and without the key secret

#### Scenario: Not configured
- **WHEN** the server has no Razorpay credentials
- **THEN** billing is reported as disabled and starting a payment answers `501 billing_disabled`

### Requirement: Plan prices and periods
Each plan SHALL state its price and currency. Free SHALL cost 0, Starter and Growth SHALL have fixed INR prices for a
30-day period, and Enterprise SHALL have no fixed price.

#### Scenario: Plans in the account view
- **WHEN** a signed-in developer loads their account
- **THEN** every plan carries `price` and `currency: "INR"`, Enterprise's price is null, and the account's plan shows when its paid period ends

### Requirement: Starting a payment
A signed-in developer SHALL be able to start a one-time payment for Starter or Growth. The server SHALL create a
Razorpay order for that plan's price, tagged with the account and plan, and return what Checkout needs.

#### Scenario: Pay for Starter
- **WHEN** a developer on Free starts a payment for `starter`
- **THEN** the server creates a Razorpay order for the Starter price in paise, tagged with the account and plan, and returns its id and the public key (201)

#### Scenario: Plans that cannot be bought online
- **WHEN** a developer starts a payment for `free` or an unknown plan
- **THEN** the server answers 400 and creates nothing
- **WHEN** they start one for `enterprise`
- **THEN** the server answers `400 contact_sales`
- **WHEN** they start one for Starter while a Growth period is still running
- **THEN** the server answers `409 plan_active` and creates nothing

### Requirement: Applying a verified payment
The plan SHALL change as soon as the browser returns Razorpay's payment response and the server has verified its
signature against the key secret and checked that the order belongs to that account. A payment SHALL be applied at
most once. Unverifiable responses SHALL change nothing.

#### Scenario: First payment
- **WHEN** a developer on Free pays for Starter and the browser sends a valid payment response
- **THEN** the account is on Starter until 30 days from now

#### Scenario: Paying again extends
- **WHEN** a developer whose Starter period ends in 10 days pays for Starter again
- **THEN** the period ends 40 days from now

#### Scenario: Moving up
- **WHEN** a developer on an active Starter period pays for Growth
- **THEN** the account is on Growth until 30 days from now

#### Scenario: Replayed, forged or foreign response
- **WHEN** the same payment response is sent twice, the signature does not match, or the order was created for another account
- **THEN** the period is not extended again, or the server answers 400 and the plan does not change

### Requirement: Expiry
When a paid period has ended the account SHALL be treated as Free everywhere (portal, allowances, rate limits,
key limits) without any operator action. Plans set by an operator SHALL NOT expire.

#### Scenario: Period lapses
- **WHEN** a developer's Starter period ended yesterday
- **THEN** their account view and their API keys use the Free plan's allowance and limits

#### Scenario: Operator-set plan
- **WHEN** an operator sets an account to Enterprise through the admin API
- **THEN** the plan has no end date

### Requirement: Webhook backup
`POST /webhooks/razorpay` SHALL accept only requests whose signature matches the webhook secret. An `order.paid` event
for an order created by the portal SHALL apply that payment exactly as browser verification does, once.

#### Scenario: Browser confirmation lost
- **WHEN** a correctly signed `order.paid` event arrives for a payment the browser never confirmed
- **THEN** the account gets the plan for 30 days

#### Scenario: Already applied
- **WHEN** an `order.paid` event arrives for a payment the browser already confirmed
- **THEN** the period is not extended again

#### Scenario: Bad signature
- **WHEN** a webhook arrives with a missing or wrong signature
- **THEN** the server answers 400 and changes nothing

### Requirement: Request fallback
Where a plan cannot be bought online (Enterprise, or billing disabled), the developer SHALL be able to send an upgrade
request that an operator reviews.

#### Scenario: Billing disabled
- **WHEN** the server has no Razorpay credentials and a developer asks for Starter
- **THEN** the dashboard sends an upgrade request and the operator sees it in `/v1/admin/upgrade-requests`
