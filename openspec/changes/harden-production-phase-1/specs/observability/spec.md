# Spec Delta

## Purpose

Lets an operator see what a running Nutrikit server is doing and whether it can serve traffic: a log line for
each request, a request id that ties a client report to that line, and separate liveness and readiness checks.

## ADDED Requirements

### Requirement: Request id
Every response SHALL carry an `X-Request-Id` header. If the request sent a well-formed `X-Request-Id` (1–128
characters: letters, digits, `-`, `_`, `.`), the server SHALL reuse it; otherwise it SHALL generate a unique id.

#### Scenario: Generated id
- **WHEN** a client calls any endpoint without `X-Request-Id`
- **THEN** the response carries a newly generated `X-Request-Id`

#### Scenario: Caller-supplied id
- **WHEN** a client sends `X-Request-Id: checkout-42`
- **THEN** the response carries `X-Request-Id: checkout-42`

#### Scenario: Error response
- **WHEN** a call fails with any 4xx or 5xx error
- **THEN** the error response also carries `X-Request-Id`

### Requirement: Structured request logs
The server SHALL write one JSON log line per completed request with the request id, method, route, status,
duration and, when authenticated, the key id and account id. The level SHALL be configurable. Unexpected 5xx
errors SHALL be logged with their stack and request id.

#### Scenario: Successful call
- **WHEN** an authenticated client calls `GET /v1/foods/search`
- **THEN** a JSON log line records the request id, route, 200 status, duration, key id and account id

#### Scenario: Internal error
- **WHEN** a handler throws an unexpected error
- **THEN** the client receives 500 `internal_error` without internal details, and the log has the stack under the same request id

### Requirement: Logs never contain secrets or bodies
Logs SHALL NOT contain request or response bodies, API keys, access tokens, the admin token, session cookies,
passwords, payment signatures or image data. Credential headers SHALL be omitted or redacted.

#### Scenario: Request with credentials
- **WHEN** a client calls the API with `Authorization: Bearer nk_...` and the portal is used with a session cookie
- **THEN** no log line contains the key, the cookie value or the request body

### Requirement: Liveness check
`GET /v1/health` SHALL answer 200 whenever the process can serve HTTP, without touching the database, so
platform health checks never restart a healthy process over a database blip.

#### Scenario: Database down
- **WHEN** the database is unreachable
- **THEN** `GET /v1/health` still answers 200

### Requirement: Readiness check
`GET /v1/health/ready` SHALL check that the database answers within 2 seconds and that the food catalog is open.
It SHALL answer 200 with each check's status when all pass, and 503 naming the failing checks otherwise. It
SHALL require no credentials and return no configuration secrets.

#### Scenario: All dependencies up
- **WHEN** the database and food catalog are available
- **THEN** `GET /v1/health/ready` answers 200 with `{ "status": "ready", "checks": { "database": "ok", "catalog": "ok" } }`

#### Scenario: Database down
- **WHEN** the database does not answer within 2 seconds
- **THEN** `GET /v1/health/ready` answers 503 with `checks.database` set to `"fail"`
