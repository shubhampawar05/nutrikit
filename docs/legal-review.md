# Legal review notes: privacy policy and terms

A checklist for whoever reviews `/privacy` and `/terms` ([web/src/pages/Legal.tsx](../web/src/pages/Legal.tsx)). It
records what was checked against India's DPDP Act 2023 and DPDP Rules 2025, and the GDPR, on 12 November 2026, and the
questions that need a lawyer's answer. **This is not legal advice.**

## Timing

The DPDP Rules 2025 were notified on 13 November 2025 with a phased start. Most obligations that matter here (Rule 3
notice, Rule 7 breach notification, Rule 8 retention, Rule 9 published contact, Rule 10 children, Rule 14 rights) apply
from **13 May 2027**. The GDPR already applies to users in the EU and UK.

## What the pages already cover

| Requirement | Where |
|---|---|
| Itemised personal data, and the purpose of each (DPDP Act s.5; GDPR Art. 13) | Privacy → What we collect, How we use it |
| How to withdraw consent, as easily as it was given (s.6(4)) | Privacy → How we use it (dashboard deletion or email) |
| How to exercise rights: access, correction, erasure, nomination (ss.11–14) | Privacy → Your rights |
| Grievance redressal first, then the Data Protection Board (s.13) | Privacy → Grievances |
| Published contact for data questions (Rule 9) | `CONTACT_EMAIL` in [web/src/legal.ts](../web/src/legal.ts) |
| Processors and international transfers (GDPR Arts. 28, 44–46) | Privacy → Who else handles it |
| Children: service limited to 18+ (s.9; Rule 10) | Privacy → Children; Terms → Your account |
| Breach notification commitment (Rule 7: Board and users without delay, detailed report within 72 hours) | Privacy → Security |
| Self-serve erasure that actually deletes the data | Dashboard → Delete account (see docs/platform.md) |

## Open questions for a lawyer

1. **Who is the data fiduciary?** The pages name "Nutrikit", which is a product, not a legal person. Should they name the
   individual or company running it, with a postal address?
2. **Notice languages.** DPDP Act s.5(3) requires the option to read the notice in English or any language in the
   Eighth Schedule of the Constitution. How should that be offered (translations, or a stated way to request one)?
3. **One-year log retention (Rule 8(3), from 13 May 2027).** The Rules appear to require keeping personal data, traffic
   data and processing logs for at least a year from processing, for the purposes in the Seventh Schedule. Account
   deletion currently removes everything at once, and request logs live only in Render's short-lived log stream.
   Does Nutrikit need to keep a minimal processing log after deletion, and what exactly?
4. **Age check.** Signup has no age confirmation. Is the 18+ statement in the terms enough, or should signup ask for
   confirmation?
5. **Liability cap.** The terms limit liability to the amount paid in the last 12 months, which is ₹0 for free users.
   Is that enforceable, and should there be a fixed minimum?
6. **Governing law and courts.** The terms say "the courts of India". Which city?
7. **Medical disclaimer.** Is the "Not medical advice" section adequate for a nutrition API whose results may reach
   end users through third-party apps?
8. **EU representative.** If EU users are expected, does GDPR Art. 27 require an EU representative?
9. **Processor agreements.** Confirm that the data processing terms of Render, Supabase, OpenAI, Anthropic, Brevo or
   Resend, and Razorpay are accepted for the accounts in use.
10. **Breach runbook.** Rule 7 needs a process for notifying the Board and users. Who does it, and how?

## Sources

- [The DPDP Rules, 2025: notified, with a phased commencement (DPDPA Forum)](https://dpdpaforum.org/bulletin/the-rules-2025-notified)
- [DPDP Rules 2025: rule-by-rule guide](https://dpdp-compliance.in/dpdp-rules)
- [Digital Personal Data Protection Rules, 2025 (Wikipedia)](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025)
- [JSA Prism InfoTech, November 2025: DPDP Rules](https://www.jsalaw.com/wp-content/uploads/2025/11/JSA-Prism-InfoTech-November-2025-DPDP-Rules.Final_.pdf)
- [Mondaq: Notification of the DPDP Rules 2025](https://www.mondaq.com/india/data-protection/1713500/regulatory-update-notification-of-the-digital-personal-data-protection-rules-2025)
- The official text is Gazette notification G.S.R. 846(E), 13 November 2025. Check dates and rule numbers against it.
