# developer-dashboard Specification

## Purpose
The signed-in developer's home in the portal: their account and plan, API keys, usage this month, upgrades, and the
first steps to a working API call, designed so a new developer never loses a key or wonders what to do next.

## Requirements

### Requirement: A new key is hard to lose
A newly created key SHALL be shown in full until the developer dismisses it, including across a page refresh in
the same tab. Dismissing a key that was never copied SHALL ask for confirmation first. When copying fails, the key
text SHALL be selected so it can be copied by hand.

#### Scenario: Refresh after signup
- **WHEN** a developer signs up and refreshes the dashboard before dismissing the key
- **THEN** the full key is still shown

#### Scenario: Dismiss without copying
- **WHEN** a developer clicks "I've saved it" without having copied the key
- **THEN** they are asked to confirm, and the key stays on screen if they cancel

#### Scenario: Clipboard blocked
- **WHEN** copying to the clipboard fails
- **THEN** the key text is selected and a message says to copy it manually

### Requirement: First request uses the revealed key
While a new key is on screen, the "Make your first request" snippet SHALL contain that key; otherwise it SHALL show
a placeholder.

#### Scenario: Snippet after creating a key
- **WHEN** a developer creates a key
- **THEN** the curl snippet below shows that key instead of `nk_your_key`

### Requirement: Loading, error and empty states
The dashboard SHALL show a loading state while the account or keys load. On failure it SHALL show a sentence-case
message with a Retry action, and a key list with no keys SHALL say so with a prompt to create one. It SHALL never
render a blank page or a bare table.

#### Scenario: Keys fail to load
- **WHEN** loading the keys fails
- **THEN** the keys card shows an error with Retry instead of an empty table

#### Scenario: Slow account load
- **WHEN** the account is still loading
- **THEN** a loading indicator is shown instead of a blank page

### Requirement: Key limit is explained before it is hit
When the account has as many active keys as its plan allows, "Create key" SHALL be disabled and the card SHALL say
how many keys the plan allows and that one must be revoked or the plan upgraded.

#### Scenario: Free plan with two keys
- **WHEN** a Free account has 2 active keys
- **THEN** "Create key" is disabled and the limit is explained next to it

### Requirement: Actions can't be sent twice
Revoke, create-key, upgrade-request and payment buttons SHALL be disabled while their request is in flight. After
an upgrade request succeeds, the dashboard SHALL show that the request was sent and SHALL not offer to send the same
request again during the visit.

#### Scenario: Double-click revoke
- **WHEN** a developer double-clicks Revoke and confirms
- **THEN** one revoke request is sent and one success message appears

#### Scenario: Upgrade request
- **WHEN** a developer requests Enterprise
- **THEN** the form is replaced by "Request sent" for that plan

### Requirement: Usage figures agree
The headline usage number, the chart and the per-endpoint table SHALL come from the same up-to-date data when the
dashboard is opened.

#### Scenario: After using the playground
- **WHEN** a developer makes calls in the playground and then opens the dashboard
- **THEN** the headline number equals the per-endpoint total

### Requirement: Billing dates are shown in UTC
Dates that mark usage or billing periods (the reset date, paid-until) SHALL be computed and shown in UTC, so every
time zone sees the same date as the server.

#### Scenario: West of UTC
- **WHEN** a developer in a UTC−5 time zone opens the dashboard in November
- **THEN** the reset date reads 1 Dec, not 30 Nov

### Requirement: Messages are written for people
Every server message the dashboard shows SHALL start with a capital letter and end with a full stop, and logging out
SHALL clear any API key the playground saved in the tab.

#### Scenario: Key limit message
- **WHEN** the server refuses a key for the plan limit
- **THEN** the message shown starts with a capital and ends with a full stop

#### Scenario: Log out
- **WHEN** a developer logs out
- **THEN** no saved playground key remains in the tab's storage
