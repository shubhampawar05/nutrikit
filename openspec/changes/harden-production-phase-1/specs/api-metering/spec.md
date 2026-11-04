# Spec Delta

## Purpose

Defines how metered /v1 calls are authenticated, held to a monthly token allowance and a per-minute rate, and
charged, so that a caller can never spend more than their plan allows, even with concurrent requests.

## ADDED Requirements

### Requirement: Credential required for metered calls
Every metered /v1 call SHALL require an active API key (`Authorization: Bearer nk_...` or `X-Api-Key`) or an
unexpired access token from the same key. Missing, unknown or revoked credentials SHALL answer `401 unauthorized`,
and an expired access token SHALL answer `401 token_expired`. No tokens SHALL be charged for a rejected credential.

#### Scenario: Revoked key
- **WHEN** a caller uses a key that has been revoked
- **THEN** the call answers 401 `unauthorized` and nothing is charged

#### Scenario: Expired access token
- **WHEN** a caller uses an `nkat_` token more than one hour after it was issued
- **THEN** the call answers 401 `token_expired`

### Requirement: Allowance is reserved atomically before work starts
Before a metered handler runs, the call's flat cost SHALL be reserved against the allowance of the caller's
account (or of the key itself, for operator keys with their own limit) in a single atomic step. If the reservation
does not fit, the call SHALL answer `429 quota_exceeded` and the handler SHALL NOT run.

#### Scenario: Concurrent calls near the limit
- **WHEN** an account has 20 tokens left and sends 10 concurrent photo calls that cost 20 tokens each
- **THEN** at most one call runs, the others answer 429 `quota_exceeded`, and the month's usage never exceeds the allowance by more than one call's AI tokens

#### Scenario: Allowance shared by an account's keys
- **WHEN** an account with two keys uses its whole allowance through the first key
- **THEN** a call through the second key answers 429 `quota_exceeded`

#### Scenario: Unlimited plan
- **WHEN** a caller on a plan with no monthly limit makes a call
- **THEN** no allowance check rejects it and `X-Tokens-Remaining` is not sent

### Requirement: Settlement after a successful call
After a successful metered call, the charge SHALL be settled to the actual cost: the flat cost of the endpoint
variant that ran plus 1 token per 1,000 AI model tokens (rounded up). The response SHALL carry `X-Tokens-Charged`
and, for limited allowances, `X-Tokens-Remaining`. AI tokens MAY take the balance below zero by at most that one
call's AI tokens.

#### Scenario: Photo call with AI usage
- **WHEN** a photo call succeeds and the provider reports 2,400 model tokens
- **THEN** the caller is charged 20 + 3 = 23 tokens and `X-Tokens-Charged: 23` is returned

#### Scenario: Cheaper variant than reserved
- **WHEN** `POST /v1/labels/parse` is called with text, reserving the image cost first
- **THEN** the caller is finally charged the text cost (5 tokens), not the image cost

### Requirement: Charging for failed calls
A failed metered call SHALL release its reservation. If the AI provider reported usage before the failure
(refusal, truncated output), the caller SHALL be charged only those AI tokens, and the error response SHALL carry
`X-Tokens-Charged`. A failure with no AI usage SHALL cost nothing.

#### Scenario: AI refusal
- **WHEN** a photo call fails with 422 because the provider declined, after using 1,500 model tokens
- **THEN** the caller is charged 2 tokens and the 422 response carries `X-Tokens-Charged: 2`

#### Scenario: Validation error
- **WHEN** a metered call fails with 400 `invalid_request` before any AI call
- **THEN** nothing is charged and the reservation is released

### Requirement: Usage history
Every charge greater than zero SHALL be recorded with the key, account, endpoint and token count, so that usage
by endpoint and by day (`GET /v1/usage`, the dashboard, the admin console) matches the allowance counter for the
same period.

#### Scenario: Usage report matches the counter
- **WHEN** a caller makes several successful and failed calls in a month
- **THEN** the `used` total from `GET /v1/usage` equals the tokens counted against the allowance

### Requirement: Per-minute rate limit
Metered calls SHALL be limited per account (or per operator key) to the plan's calls per minute, shared by every
server instance. Exceeding it SHALL answer `429 rate_limited` with `Retry-After` in seconds, before any allowance is
reserved.

#### Scenario: Burst over the plan rate
- **WHEN** a Free account makes 31 calls within one minute
- **THEN** the 31st answers 429 `rate_limited` with a `Retry-After` header and is not charged
