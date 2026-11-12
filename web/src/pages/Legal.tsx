// The privacy policy (/privacy) and terms of use (/terms). Facts that change (operator, contact, date) live in
// legal.ts. Keep the policy in step with what the server stores: see docs/platform.md, "Personal data".
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CONTACT_EMAIL, OPERATOR, UPDATED } from '../legal.ts';

const Contact = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

function LegalPage({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <main className="wrap legal">
      <span className="kicker">{kicker}</span>
      <h1>{title}</h1>
      <p className="muted">Last updated {UPDATED}</p>
      {children}
    </main>
  );
}

export function Privacy() {
  return (
    <LegalPage kicker="Legal" title="Privacy policy">
      <p className="lead">
        This policy explains what {OPERATOR} collects when you use this website and its API, why, who else handles it,
        and how to see or delete it. We collect only what we need to run the service. We don't sell your data and we
        don't use advertising or analytics trackers.
      </p>

      <h2 id="who">Who we are</h2>
      <p>
        {OPERATOR} ("we") runs this website, the developer dashboard and the Nutrikit API, and decides how the
        personal data described here is used. For any privacy question, data request or complaint, write to <Contact />.
      </p>

      <h2 id="collect">What we collect</h2>
      <h3>When you create an account</h3>
      <ul>
        <li><b>Name or company and email address</b>, to identify your account, sign you in and send verification and password-reset emails.</li>
        <li><b>Password</b>, stored only as a salted scrypt hash. We can't read it.</li>
        <li><b>Plan, sign-up date and whether your email is confirmed.</b></li>
      </ul>
      <h3>When you or your apps use the API</h3>
      <ul>
        <li><b>API keys</b>: their names, when they were created and last used. The keys themselves are stored only as hashes.</li>
        <li><b>Usage records</b>: for each call, the endpoint, the tokens it cost, the time and which key made it. We use these to count your monthly allowance and to show your usage.</li>
        <li>
          <b>What you send to be analysed</b>: meal descriptions, voice transcripts (speech is turned into text on your
          device, not by us), food and nutrition-label photos, and barcodes. We process these to answer the request and
          don't store them. A barcode's product data is cached to speed up later lookups, without any record of who asked.
        </li>
      </ul>
      <h3>To keep the service secure</h3>
      <ul>
        <li><b>IP addresses</b> of sign-ups (kept 1 hour) and of failed logins together with the email tried (kept 15 minutes), to stop automated abuse.</li>
        <li><b>Email sends</b> (address, type, time; kept 1 day), to limit how many emails one address can receive.</li>
        <li>
          <b>Server logs</b>: one line per request with its method, route, status, duration, a request id and, if signed in,
          the account or key id. Logs never contain request bodies, passwords, keys or cookies. They are kept by our
          hosting provider for its log retention period.
        </li>
      </ul>
      <h3>Payments</h3>
      <p>
        Paid plans are not offered at the moment. If they are, payments are handled by Razorpay: we never see your card,
        bank or UPI details. We keep the payment and order ids, plan, amount and date.
      </p>
      <h3>Cookies and browser storage</h3>
      <p>
        One cookie, <code>nk_session</code>, keeps you signed in. It is necessary for the dashboard to work, cannot be read
        by scripts, and expires after 14 days or when you log out. The site also uses your browser's session storage, which
        is cleared when the tab closes, to keep a newly created key on screen and a key you pasted into the playground.
        There are no analytics, advertising or third-party cookies.
      </p>

      <h2 id="use">How we use it</h2>
      <p>
        To provide the service you signed up for: running your account and API keys, answering API calls, counting usage
        against your plan, sending account emails, preventing abuse, and fixing problems. We don't use your data for
        advertising, sell it, or use what you send to the API to train models.
      </p>
      <p>
        Under India's Digital Personal Data Protection Act, we process your data with the consent you give when you create
        an account. Under the GDPR (for users in the EU or UK), our legal basis is our contract with you to provide the
        service, and our legitimate interest in keeping it secure. You can withdraw consent at any time, as easily as you
        gave it, by deleting your account from the dashboard or writing to <Contact />. Withdrawing doesn't affect
        processing that happened before, and we can no longer provide the service afterwards.
      </p>

      <h2 id="share">Who else handles it</h2>
      <p>These providers process data on our behalf, only to run the service:</p>
      <ul>
        <li><b>Render</b> (hosting, in the EU) and <b>Supabase</b> (database, in the EU): everything stored by the service.</li>
        <li><b>OpenAI</b> or <b>Anthropic</b>: the photo or text of a request that uses AI, such as a meal photo, a label photo or AI-assisted logging. Under their API terms they don't use it to train models.</li>
        <li><b>Brevo</b> or <b>Resend</b>: your email address and the content of verification and password-reset emails.</li>
        <li><b>Open Food Facts</b>: barcode numbers we look up. No personal data is sent.</li>
        <li><b>Razorpay</b>: payment details, if paid plans are offered.</li>
      </ul>
      <p>
        We disclose data to anyone else only if the law requires it.
      </p>
      <p>
        <b>Where your data goes:</b> our servers and database are in the EU, so data from users in India and elsewhere is
        transferred there. OpenAI, Anthropic and Resend process data in the United States, Brevo in the EU, and Razorpay in
        India. For transfers out of the EU we rely on these providers' standard contractual clauses or an equivalent
        safeguard recognised under the GDPR.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <p>
        Account data, keys and usage records are kept until you delete your account. Security records are deleted
        automatically after the periods above. Payment records are kept as long as tax and accounting law requires, even
        after an account is deleted, but no longer linked to your name or email. Where a law requires us to keep records
        of processing for a minimum period, we keep those records for that period only, and use them for nothing else.
        Data may remain in database backups until those backups expire.
      </p>

      <h2 id="rights">Your rights</h2>
      <p>You can:</p>
      <ul>
        <li><b>See and correct your data</b>: your name, email, plan, keys and usage are shown in your <Link to="/dashboard">dashboard</Link>. Write to us for anything else or to correct it.</li>
        <li><b>Delete your account</b> yourself, at any time: Dashboard → Delete account. It deletes your account, keys, usage history and sessions at once and cannot be undone.</li>
        <li><b>Get a copy of your data</b>, have it corrected, or object to or restrict how we use it, by writing to <Contact />.</li>
        <li><b>Nominate someone</b> to exercise these rights for you if you die or become unable to, by writing to us.</li>
      </ul>
      <h3 id="grievances">Grievances</h3>
      <p>
        For any complaint about how we handle your data, write to our grievance contact at <Contact />. We acknowledge
        complaints promptly and answer within 30 days. If you're in India and not satisfied with our answer, you can then
        complain to the Data Protection Board of India. In the EU or UK, you can complain to your data protection authority
        at any time.
      </p>

      <h2 id="children">Children</h2>
      <p>The service is for developers aged 18 or over. We don't knowingly collect data from children; if you believe a child has created an account, write to us and we'll delete it.</p>

      <h2 id="security">Security</h2>
      <p>
        Connections are encrypted (HTTPS). Passwords, keys, sessions and email links are stored only as hashes, failed
        logins are limited, and access to the database is restricted. No system is perfectly secure; if a breach affects
        your data, we'll tell you and the authorities as the law requires.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>We'll update the date at the top when this policy changes, and email account holders about significant changes before they take effect.</p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage kicker="Legal" title="Terms of use">
      <p className="lead">
        These terms apply to the {OPERATOR} website, developer dashboard and API (the "service"). By creating an account or
        using an API key you agree to them. Our <Link to="/privacy">privacy policy</Link> explains how we handle your data.
      </p>

      <h2 id="account">Your account</h2>
      <ul>
        <li>You must be 18 or over, and able to accept these terms for yourself or the organisation you sign up for.</li>
        <li>Give a real email address and keep your password and API keys secret. You're responsible for calls made with your keys; revoke a key in the dashboard if it leaks.</li>
        <li>One free account per person or organisation. Don't create extra accounts to get more free allowance.</li>
      </ul>

      <h2 id="service">The service</h2>
      <p>
        The free plan includes a monthly token allowance and a rate limit, shown in your dashboard. We may change features,
        allowances and limits, and will give notice of changes that reduce them where we reasonably can. The service is new
        and offered without any uptime guarantee.
      </p>

      <h2 id="use">Acceptable use</h2>
      <p>Don't:</p>
      <ul>
        <li>break the law, or send content you don't have the right to send (including photos of other people without their permission);</li>
        <li>try to get around rate limits, allowances or security, probe for vulnerabilities without our written permission, or overload the service;</li>
        <li>copy the food database in bulk, or resell raw API access as your own nutrition API;</li>
        <li>use the service to harm, harass or mislead others.</li>
      </ul>
      <p>We may suspend or close accounts and revoke keys that break these rules, and will tell you why unless the law or security prevents it.</p>

      <h2 id="content">Your content</h2>
      <p>
        What you send to the API stays yours. You let us process it only to answer your requests, as described in the
        privacy policy. You may use the responses in your own apps and products, subject to the data licences below.
      </p>

      <h2 id="data">Food data and attribution</h2>
      <p>
        Nutrition data comes from USDA FoodData Central (public domain), UK CoFID (Open Government Licence v3.0), the Indian
        Nutrient Databank, and Open Food Facts (Open Database License). When your app shows Open Food Facts data, display
        "Data from Open Food Facts contributors", as every such response's <code>license</code> field says. Details are in
        the <Link to="/docs#data">documentation</Link>.
      </p>

      <h2 id="health">Not medical advice</h2>
      <p>
        Nutrient values are averages and estimates. Results from photos, labels and free text are produced by automated
        matching and AI models and can be wrong. Don't rely on the service for medical, allergy or dietary decisions. Ask a
        qualified professional, and make sure your own users understand this too.
      </p>

      <h2 id="paid">Paid plans</h2>
      <p>
        Paid plans are not offered at the moment. If they are, the price and what's included will be shown before you pay.
        Each payment buys 30 days of the plan and is not refundable except where the law requires it.
      </p>

      <h2 id="ending">Ending your use</h2>
      <p>
        You can stop at any time and delete your account from the dashboard. We may end the service, or your access, with
        reasonable notice, or immediately for serious or repeated breaches of these terms.
      </p>

      <h2 id="liability">Warranties and liability</h2>
      <p>
        The service is provided "as is", without warranties of any kind, to the extent the law allows. We are not liable for
        indirect or consequential losses, or for losses caused by inaccurate nutrition data. Our total liability for any
        claim about the service is limited to the amount you paid us in the 12 months before it. Nothing in these terms
        limits liability that cannot be limited by law.
      </p>

      <h2 id="law">Governing law</h2>
      <p>These terms are governed by the laws of India, and disputes go to the courts of India, unless the law where you live gives you the right to bring them elsewhere.</p>

      <h2 id="changes">Changes and contact</h2>
      <p>
        We'll update the date at the top when these terms change, and email account holders about significant changes
        before they take effect. Continuing to use the service afterwards means you accept them. Questions: <Contact />.
      </p>
    </LegalPage>
  );
}
