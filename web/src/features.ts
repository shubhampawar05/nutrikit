// Switches for parts of the site that are not ready to show.

/**
 * Paid plans: the Pricing page and its links, and the dashboard's upgrade and payment form. While false, every
 * account stays on the Free plan, /pricing sends visitors to the homepage, and the page is left out of the sitemap.
 * To show payments again: set this to true and set "index": true on "/pricing" in seo.json.
 */
export const PAYMENTS_VISIBLE = false;
