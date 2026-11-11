// Outgoing email (verification and password-reset links), sent over HTTPS so it works on hosts that block SMTP ports
// (Render's free plan does).
//
//   Brevo   BREVO_API_KEY + NUTRIKIT_MAIL_FROM. Free plan; the sender can be a single verified address such as a Gmail
//           address, so no domain is needed.
//   Resend  RESEND_API_KEY + NUTRIKIT_MAIL_FROM on a domain verified in Resend.
//
// NUTRIKIT_MAIL_PROVIDER (brevo | resend) picks one when both keys are set; otherwise Brevo, then Resend. Each call has
// a 15 s deadline. With no provider, outside production the message is printed to the console so links can be followed
// locally; in production it is not sent and the caller logs a warning without the message, because a link carries a
// one-time token and logs never do. Tests swap the mailer with setMailer().

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  name: string;
  send(mail: Mail): Promise<void>;
}

const TIMEOUT_MS = () => Number(process.env.NUTRIKIT_MAIL_TIMEOUT_MS) || 15_000;

function resend(apiKey: string, from: string): Mailer {
  return {
    name: 'resend',
    async send({ to, subject, text }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS()),
      });
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}

/** "Nutrikit <no-reply@example.com>" -> { name: 'Nutrikit', email: 'no-reply@example.com' }; a bare address has no name. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = from.trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (!m) return { email: from.trim() };
  const name = m[1]!.replace(/^"|"$/g, '').trim();
  return name ? { name, email: m[2]! } : { email: m[2]! };
}

function brevo(apiKey: string, from: string): Mailer {
  const sender = parseSender(from);
  return {
    name: 'brevo',
    async send({ to, subject, text }) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
        signal: AbortSignal.timeout(TIMEOUT_MS()),
      });
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}

const consoleMailer: Mailer = {
  name: 'console',
  async send({ to, subject, text }) {
    process.stdout.write(`\n--- email (not sent: no mail provider configured) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n\n`);
  },
};

const unconfigured: Mailer = {
  name: 'none',
  async send() {
    throw new Error('no mail provider configured (set BREVO_API_KEY or RESEND_API_KEY, and NUTRIKIT_MAIL_FROM)');
  },
};

export function fromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const { BREVO_API_KEY, RESEND_API_KEY, NUTRIKIT_MAIL_FROM, NUTRIKIT_MAIL_PROVIDER } = env;
  const choice = NUTRIKIT_MAIL_PROVIDER?.toLowerCase() || (BREVO_API_KEY ? 'brevo' : RESEND_API_KEY ? 'resend' : '');
  if (NUTRIKIT_MAIL_FROM && choice === 'brevo' && BREVO_API_KEY) return brevo(BREVO_API_KEY, NUTRIKIT_MAIL_FROM);
  if (NUTRIKIT_MAIL_FROM && choice === 'resend' && RESEND_API_KEY) return resend(RESEND_API_KEY, NUTRIKIT_MAIL_FROM);
  return env.NODE_ENV === 'production' ? unconfigured : consoleMailer;
}

let current: Mailer | undefined;

export const mailer = (): Mailer => (current ??= fromEnv());

/** Replace the mailer (tests), or pass nothing to read the environment again. */
export function setMailer(m?: Mailer) {
  current = m;
}
