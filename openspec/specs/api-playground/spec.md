# api-playground Specification

## Purpose
Lets a visitor or signed-in developer try every API endpoint in the browser, with their session or a pasted key,
and see the request, the response, its cost and what to do when something goes wrong.

## Requirements

### Requirement: The credential shown is the credential used
Requests SHALL be sent with exactly the credential the playground says it is using. Choosing "Use another key"
SHALL stop using the session until the developer chooses to go back to their account, which SHALL be possible
without reloading the page.

#### Scenario: Switch to a pasted key
- **WHEN** a signed-in developer chooses "Use another key" and pastes a key
- **THEN** the next request is sent with the pasted key, not the session token

#### Scenario: Back to the session
- **WHEN** they then choose to use their account again
- **THEN** requests use a fresh session token and the "Signed in" state returns

#### Scenario: Another key with nothing pasted
- **WHEN** a developer chooses "Use another key" and sends without pasting one
- **THEN** the playground asks for a key instead of sending with the session

### Requirement: One request at a time
While a request is in flight, sending again by button, keyboard shortcut or example chip SHALL do nothing.

#### Scenario: Repeated shortcut
- **WHEN** a developer presses Ctrl/⌘+Enter three times quickly
- **THEN** one request is sent and charged

### Requirement: Guidance fits the developer's situation
Error guidance SHALL match the developer's state. A signed-in developer with no active key SHALL be pointed to the
dashboard to create one, and a quota error SHALL point to upgrading from the dashboard. A missing AI provider SHALL
be described as a feature that isn't available on this server, without server configuration details.

#### Scenario: Signed in without a key
- **WHEN** a signed-in developer with no active key sends a request
- **THEN** the playground says to create a key in the dashboard and links there, without "Log in" or "Get a free key"

#### Scenario: AI not available
- **WHEN** an AI endpoint answers `501 ai_provider_unavailable`
- **THEN** the hint says AI features aren't enabled on this server and names the endpoints that still work, without mentioning environment variables

### Requirement: Previews describe results accurately
A preview SHALL show the quantity the user said and the grams ("2 eggs · 100 g"), units on every nutrient value, and,
when a successful response can't be previewed, a message pointing to the JSON tab rather than a network error.

#### Scenario: Two eggs
- **WHEN** a developer logs "2 eggs"
- **THEN** the item reads "2 eggs · 100 g", not "1 egg · 100 g"

#### Scenario: Label per 100 g
- **WHEN** a label is parsed
- **THEN** every per-100 g value shows its unit

#### Scenario: Preview cannot render
- **WHEN** a 2xx response can't be shown as a preview
- **THEN** the message says to see the JSON tab, not that the API can't be reached
