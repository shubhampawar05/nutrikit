# Spec Delta

## ADDED Requirements

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
