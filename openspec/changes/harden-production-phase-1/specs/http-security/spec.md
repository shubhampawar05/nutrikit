# Spec Delta

## Purpose

Covers the HTTP-level protections every Nutrikit deployment needs: resolving the real client address behind
proxies, sending browser security headers, and putting time limits on calls to outside services so one slow
dependency cannot tie up the server.

## ADDED Requirements

### Requirement: Client address behind proxies
The server SHALL use the client address taken from `X-Forwarded-For` only across the configured number of
trusted proxy hops (default 0, meaning the socket address). Every per-address rule (demo limit, signup and login
throttles) SHALL use this address.

#### Scenario: One trusted proxy
- **WHEN** one proxy hop is trusted and a request arrives with `X-Forwarded-For: 203.0.113.7`
- **THEN** per-address limits count the request against 203.0.113.7, not the proxy's address

#### Scenario: Spoofed header without a trusted proxy
- **WHEN** no proxy is trusted and a client sends a forged `X-Forwarded-For`
- **THEN** the header is ignored and the socket address is used

### Requirement: Security headers on every response
Every response SHALL carry `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
When secure cookies are enabled, responses SHALL also carry `Strict-Transport-Security` with a max-age of at
least 180 days.

#### Scenario: API response
- **WHEN** a client calls `GET /v1/health`
- **THEN** the response includes `X-Content-Type-Options: nosniff` and `Referrer-Policy`

#### Scenario: Production deployment
- **WHEN** secure cookies are enabled
- **THEN** every response includes `Strict-Transport-Security`

### Requirement: Content Security Policy for website pages
Website pages SHALL be served with a Content Security Policy that allows scripts only from the site itself and
the payment provider the portal uses. They SHALL refuse framing by other sites, and they SHALL
allow images from Open Food Facts.

#### Scenario: Injected inline script
- **WHEN** a website page is loaded
- **THEN** its Content-Security-Policy does not allow inline scripts or scripts from unlisted origins

#### Scenario: Framing
- **WHEN** another site embeds a Nutrikit page in a frame
- **THEN** the browser refuses, because of `frame-ancestors 'none'` and `X-Frame-Options: DENY`

### Requirement: Time limits on AI provider calls
A call to the AI provider SHALL be abandoned after a configurable timeout (default 60 seconds), and the API
SHALL answer `504 ai_timeout`. The caller SHALL NOT be charged for a timed-out call.

#### Scenario: Provider hangs
- **WHEN** the AI provider does not finish a photo request within the timeout
- **THEN** the API answers 504 `ai_timeout` and charges nothing

### Requirement: Time limits on other outside calls
Calls to Open Food Facts and Razorpay SHALL each have a timeout of at most 15 seconds. A
timeout SHALL be reported with that integration's existing error (for example `502 billing_error`), not left
hanging.

#### Scenario: Payment provider hangs
- **WHEN** Razorpay does not answer an order request within its timeout
- **THEN** the portal call answers 502 `billing_error`
