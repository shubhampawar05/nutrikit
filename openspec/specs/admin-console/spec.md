# admin-console Specification

## Purpose
Give operators a browser console, backed by the admin API, to see accounts, purchases and API keys, revoke keys,
change plans and review upgrade requests without curl or SQL.

## Requirements

### Requirement: Admin sign-in
The console at `/admin` SHALL require the admin token. A wrong token SHALL be refused and nothing SHALL be shown;
signing out SHALL forget the token in that browser tab.

#### Scenario: Correct token
- **WHEN** an operator enters the configured admin token
- **THEN** the console opens on the overview

#### Scenario: Wrong token
- **WHEN** an operator enters any other value
- **THEN** the console shows "That admin token was not accepted" and no data

### Requirement: Overview
The admin API SHALL report the number of accounts, accounts per effective plan, active paid periods, payment count
and revenue (all time and last 30 days), active keys, pending upgrade requests and tokens used this month.

#### Scenario: After one Starter payment
- **WHEN** one account paid ₹1,499 for Starter today
- **THEN** the overview shows 1 active paid period, 1 payment and ₹1,499 revenue for all time and the last 30 days

### Requirement: Payments list
The admin API SHALL list payments newest first with the paying account's email, plan, amount, period end and the
Razorpay payment and order ids, optionally filtered by email.

#### Scenario: Filter by email
- **WHEN** the operator searches payments for `test11@`
- **THEN** only that account's payments are listed

### Requirement: Accounts list
The admin API SHALL list accounts with email, name, effective plan, paid-until date, active key count, tokens used
this month and total paid, optionally filtered by email or name. The console SHALL let the operator change an
account's plan.

#### Scenario: Expired period
- **WHEN** an account's Starter period has ended
- **THEN** it is listed on Free with no paid-until date

#### Scenario: Change plan
- **WHEN** the operator sets an account to Enterprise in the console
- **THEN** the account is on Enterprise with no end date

### Requirement: Key management
The admin key list SHALL include each key's account email and name. The console SHALL let the operator revoke an
active key after confirming; revoked keys and the access tokens issued from them SHALL stop working at once.

#### Scenario: Revoke from the console
- **WHEN** the operator revokes a developer's key and confirms
- **THEN** the key is shown as revoked and API calls with it answer 401

### Requirement: Admin API protection
Every admin endpoint SHALL answer `401 unauthorized` without the admin token.

#### Scenario: No token
- **WHEN** `/v1/admin/overview`, `/v1/admin/accounts` or `/v1/admin/payments` is called without the token
- **THEN** the server answers 401 and returns no data

### Requirement: Admin search is calm
Search boxes in the admin console SHALL wait until the operator pauses typing (about 300 ms) before querying, and
SHALL keep the current results visible, with a loading indicator, until new results arrive.

#### Scenario: Typing an email
- **WHEN** an operator types "priya@" into the accounts search
- **THEN** one search request is sent after they pause, and the table never goes blank in between

### Requirement: A rejected admin token ends the session
When any admin request is refused with 401, the console SHALL forget the stored token and return to the sign-in
form with a message that the token was not accepted.

#### Scenario: Token rotated
- **WHEN** the operator's admin token is changed on the server while the console is open, and they switch tabs
- **THEN** the console shows the sign-in form saying the token is no longer accepted
