// Facts the privacy policy and terms depend on. Change them here, and bump UPDATED when either page changes.
// legal.test.tsx fails while CONTACT_EMAIL is still the placeholder, so a page without a real contact can't ship.

/** Who runs the service, as named in the privacy policy and terms. */
export const OPERATOR = 'Nutrikit';

/** Where people write about privacy, data requests and grievances. Must be an inbox someone reads. */
export const CONTACT_EMAIL = 'nutrikit@gmail.com';

/** Date both pages were last changed (shown at the top of each). */
export const UPDATED = '12 November 2026';
