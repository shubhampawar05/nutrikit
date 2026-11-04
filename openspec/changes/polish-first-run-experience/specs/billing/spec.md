# Spec Delta

## MODIFIED Requirements

### Requirement: Starting a payment
A signed-in developer SHALL be able to start a one-time payment for Starter or Growth. The server SHALL create a
Razorpay order for that plan's price, tagged with the account and plan, and return what Checkout needs. A payment
SHALL NOT move an account to a plan cheaper than the one it is on, whether that plan was paid for or set by an
operator; Enterprise ranks above every plan that can be bought online.

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

#### Scenario: Operator-set plan
- **WHEN** an operator put an account on Growth (no end date) and the developer starts a payment for Starter
- **THEN** the server answers `409 plan_active` and creates nothing

#### Scenario: Enterprise account
- **WHEN** a developer on Enterprise starts a payment for Starter or Growth
- **THEN** the server answers `409 plan_active` and creates nothing

#### Scenario: Extending or moving up
- **WHEN** a developer on an operator-set Starter plan starts a payment for Starter or Growth
- **THEN** the server creates the order

## ADDED Requirements

### Requirement: Clear outcome when payment confirmation fails
When the portal cannot confirm a payment that Checkout reported as successful, the dashboard SHALL tell the
developer that a charged payment will still be applied (by the webhook) or can be resolved with support, SHALL show
the Razorpay payment id, and SHALL refresh the plan shortly afterwards.

#### Scenario: Verification error after Checkout
- **WHEN** Checkout succeeds but `POST /portal/api/billing/verify` fails
- **THEN** the dashboard shows the payment id and a message saying the plan will activate shortly if the payment went through, and reloads the account within a minute
