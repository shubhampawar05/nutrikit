# web-accessibility Specification

## Purpose
Accessibility and touch requirements that every page of the Nutrikit website meets, so keyboard, screen-reader and
phone users can sign up, manage keys and try the API as easily as anyone else.

## Requirements

### Requirement: Form errors are tied to their fields
Every form field with an error SHALL be marked invalid and SHALL reference its error text, so assistive technology
announces the error with the field.

#### Scenario: Signup error
- **WHEN** signup fails with an email error
- **THEN** the email input has `aria-invalid="true"` and `aria-describedby` pointing at the error text

### Requirement: Status messages are announced once and never overlap
Toast messages SHALL be added to one persistent live region, so screen readers announce each message once. Several
messages SHALL stack without overlapping. A newly revealed API key SHALL NOT be read aloud; focus SHALL move to its
heading instead.

#### Scenario: Two toasts
- **WHEN** two messages appear within a second
- **THEN** both are visible and announced, one above the other

#### Scenario: New key
- **WHEN** a key is created
- **THEN** screen readers hear "New key created" and the key itself is not read out

### Requirement: Tabs follow the ARIA tabs pattern
Every tab set SHALL have a label and pair each tab with its panel. Arrow keys SHALL move between tabs, and only the
selected tab SHALL be in the tab order.

#### Scenario: Keyboard tabs
- **WHEN** focus is on the first playground tab and the user presses the right arrow key
- **THEN** focus and selection move to the next tab, and Tab moves into its panel

### Requirement: Everything works from the keyboard
Every control SHALL be reachable and usable from the keyboard: the photo upload, menus and dialogs included. The
site SHALL offer a skip-to-content link. The mobile menu SHALL close on Escape and return focus to its button. Focus
SHALL always be visible.

#### Scenario: Photo upload
- **WHEN** a keyboard user tabs to the photo drop zone and presses Enter
- **THEN** the file picker opens

#### Scenario: Skip link
- **WHEN** a keyboard user presses Tab on page load
- **THEN** the first focus is a visible "Skip to content" link

#### Scenario: Mobile menu
- **WHEN** the mobile menu is open and the user presses Escape
- **THEN** it closes and focus returns to the menu button

### Requirement: Controls and tables have meaningful names
Buttons that repeat per row SHALL name their target (for example "Revoke Default key"). Table header cells SHALL be
in a header row with column scope. Landmarks labelled with `aria-label` SHALL have a role that supports a label. The
usage chart SHALL have a text alternative with the daily figures.

#### Scenario: Revoke buttons
- **WHEN** a screen reader lists the keys table's buttons
- **THEN** each Revoke button names its key

#### Scenario: Usage chart
- **WHEN** a screen reader reaches the usage chart
- **THEN** it can read each day's date and tokens

### Requirement: Touch targets and anchors work on phones
On touch screens, buttons, chips and copy buttons SHALL be at least 44 px tall. Jumping to an in-page anchor SHALL
not hide the target under the sticky header.

#### Scenario: Copy button on a phone
- **WHEN** the site is used on a touch screen
- **THEN** copy buttons and example chips are at least 44 px tall

#### Scenario: Footer link to a section
- **WHEN** a visitor follows a link to /#how
- **THEN** the section's heading is visible below the header
