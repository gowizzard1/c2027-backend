/**
 * Email delivery via SMTP (e.g. Gmail with an App Password).
 * When SMTP isn't configured, emails are logged to the console (dev fallback)
 * so the app never crashes and the invite content is still visible.
 */
import nodemailer, { Transporter } from 'nodemailer';
import { promises as dns } from 'dns';
import logger from '../lib/logger';

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function getTransport(): Promise<Transporter> {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT || 465);
  let connectionHost = smtpHost;

  // Railway containers may receive an unreachable IPv6 address for smtp.gmail.com.
  // Resolve IPv4 explicitly, but preserve the hostname as the TLS SNI name so Gmail's
  // certificate continues to validate correctly.
  try {
    const [ipv4] = await dns.resolve4(smtpHost);
    if (ipv4) {
      connectionHost = ipv4;
      logger.debug({ smtpHost, ipv4 }, 'Resolved SMTP host to IPv4');
    }
  } catch (err) {
    // Fall back to the hostname; this remains useful for SMTP providers that don't
    // publish an A record or environments where DNS resolution is unavailable.
    logger.warn({ err, smtpHost }, 'Could not resolve SMTP host to IPv4; using hostname');
  }

  transporter = nodemailer.createTransport({
    host: connectionHost,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Required when connecting to an IP address over TLS (SNI / certificate validation).
    tls: { servername: smtpHost },
  });
  return transporter;
}

function fromAddress(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@campaign.local';
}

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function sendEmail({ to, subject, text, html }: SendArgs) {
  if (!isEmailConfigured()) {
    logger.warn({ to, subject }, '[Email MOCK] SMTP not configured — email not sent');
    console.log(`[Email MOCK] To: ${to}\nSubject: ${subject}\n${text}`);
    return false;
  }
  try {
    const smtp = await getTransport();
    await smtp.sendMail({ from: fromAddress(), to, subject, text, html });
    logger.info({ to, subject }, 'Email sent');
    return true;
  } catch (err) {
    // Do not reuse a failed connection/client on the next approval attempt.
    transporter = null;
    logger.error({ err, to }, 'Email send failed');
    return false;
  }
}

/**
 * Send a volunteer their invite: activation link (to set a password) + login info.
 */
export async function sendVolunteerInvite(params: {
  to: string;
  name: string;
  email: string;
  activationLink: string;
  loginUrl: string;
}): Promise<boolean> {
  const { to, name, email, activationLink, loginUrl } = params;
  const first = name.split(' ')[0] || name;

  const text =
`Hi ${first},

You've been approved as a Maiywa 4 Turbo 2027 volunteer! 🎉

1) Activate your account and set a password:
${activationLink}

2) After that, log in anytime at:
${loginUrl}
   Email: ${email}

Together we rise! 🇰🇪
— Maiywa 4 Turbo 2027`;

  const html =
`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0D0D0D">
  <div style="background:#0D0D0D;padding:20px;border-radius:12px 12px 0 0">
    <h2 style="color:#F5C100;margin:0">Maiywa 4 Turbo 2027</h2>
  </div>
  <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
    <p>Hi ${first},</p>
    <p>You've been <strong>approved</strong> as a Maiywa 4 Turbo 2027 volunteer! 🎉</p>
    <p><strong>Step 1 — Activate &amp; set your password:</strong></p>
    <p><a href="${activationLink}" style="display:inline-block;background:#1A7A3C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Activate My Account</a></p>
    <p style="font-size:12px;color:#666">Or paste this link: ${activationLink}</p>
    <p><strong>Step 2 — Log in anytime at:</strong><br>
       <a href="${loginUrl}">${loginUrl}</a><br>
       Email: <strong>${email}</strong></p>
    <p style="margin-top:24px">Together we rise! 🇰🇪<br>— Maiywa 4 Turbo 2027</p>
  </div>
</div>`;

  return sendEmail({ to, subject: "You're approved — activate your Maiywa 4 Turbo 2027 volunteer account", text, html });
}
