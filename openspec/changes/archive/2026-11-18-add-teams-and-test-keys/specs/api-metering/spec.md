# Spec Delta

## ADDED Requirements

### Requirement: Test keys are separate from the plan
Keys SHALL be created as live (`nk_live_…`) or test (`nk_test_…`); keys created before this change SHALL be live.
Calls with a test key, or an access token from one, SHALL count against a monthly test allowance per team
(`NUTRIKIT_TEST_TOKENS`, default 5,000) and a per-minute test rate (`NUTRIKIT_TEST_RATE_LIMIT`, default 30), and
SHALL NOT count against the team's plan allowance or its live usage figures. Every test-mode response SHALL carry
`X-Nutrikit-Mode: test`.

#### Scenario: CI runs the test suite
- **WHEN** a team's CI makes 1,000 search calls with a test key
- **THEN** the team's live allowance and dashboard usage are unchanged, and the test allowance is 1,000 tokens lower

#### Scenario: Test allowance exhausted
- **WHEN** a team has used its whole test allowance this month
- **THEN** test calls answer 429 `quota_exceeded` while live keys keep working

### Requirement: Test keys never call the AI provider
In test mode, photo logging, label photos, AI text logging and the advisor SHALL answer from fixed sample results
(`provider: "test"`) without calling the AI provider and without AI charges, in the same response shape as live
calls. Calls that don't use AI SHALL answer with real catalog data.

#### Scenario: Photo in test mode
- **WHEN** a test key sends any image to photo logging
- **THEN** the response lists the sample foods matched to catalog foods, `provider` is "test", and only the flat cost is charged to the test allowance
