/**
 * Email delivery via SMTP (e.g. Gmail with an App Password).
 * When SMTP isn't configured, emails are logged to the console (dev fallback)
 * so the app never crashes and the invite content is still visible.
 */
import nodemailer, { Transporter } from 'nodemailer';
import logger from '../lib/logger';

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
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

async function sendEmail({ to, subject, text, html }: SendArgs): Promise<boolean> {
  if (!isEmailConfigured()) {
    logger.warn({ to, subject }, '[Email MOCK] SMTP not configured — email not sent');
    console.log(`[Email MOCK] To: ${to}\nSubject: ${subject}\n${text}`);
    return false;
  }
  try {
    await getTransport().sendMail({ from: fromAddress(), to, subject, text, html });
    logger.info({ to, subject }, 'Email sent');
    return true;
  } catch (err) {
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

You've been approved as a Campaign 2027 volunteer! 🎉

1) Activate your account and set a password:
${activationLink}

2) After that, log in anytime at:
${loginUrl}
   Email: ${email}

Together we rise! 🇰🇪
— Campaign 2027`;

  const html =
`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0D0D0D">
  <div style="background:#0D0D0D;padding:20px;border-radius:12px 12px 0 0">
    <h2 style="color:#F5C100;margin:0">Campaign 2027</h2>
  </div>
  <div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px">
    <p>Hi ${first},</p>
    <p>You've been <strong>approved</strong> as a Campaign 2027 volunteer! 🎉</p>
    <p><strong>Step 1 — Activate &amp; set your password:</strong></p>
    <p><a href="${activationLink}" style="display:inline-block;background:#1A7A3C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Activate My Account</a></p>
    <p style="font-size:12px;color:#666">Or paste this link: ${activationLink}</p>
    <p><strong>Step 2 — Log in anytime at:</strong><br>
       <a href="${loginUrl}">${loginUrl}</a><br>
       Email: <strong>${email}</strong></p>
    <p style="margin-top:24px">Together we rise! 🇰🇪<br>— Campaign 2027</p>
  </div>
</div>`;

  return sendEmail({ to, subject: "You're approved — activate your Campaign 2027 volunteer account", text, html });
}
