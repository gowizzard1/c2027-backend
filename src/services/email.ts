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

export type EmailSendOutcome = {
  status: 'accepted' | 'not_configured' | 'failed';
  providerMessageId?: string;
  failureReason?: string;
};

async function sendEmailDetailed({ to, subject, text, html }: SendArgs): Promise<EmailSendOutcome> {
  if (!isEmailConfigured()) {
    logger.warn({ to, subject }, '[Email MOCK] SMTP not configured — email not sent');
    console.log(`[Email MOCK] To: ${to}\nSubject: ${subject}\n${text}`);
    return { status: 'not_configured', failureReason: 'Email delivery is not configured.' };
  }
  try {
    const smtp = await getTransport();
    const result = await smtp.sendMail({ from: fromAddress(), to, subject, text, html });
    logger.info({ to, subject, messageId: result.messageId }, 'Email accepted by SMTP provider');
    return { status: 'accepted', providerMessageId: result.messageId };
  } catch (err) {
    // Do not reuse a failed connection/client on the next approval attempt.
    transporter = null;
    logger.error({ err, to }, 'Email send failed');
    return { status: 'failed', failureReason: 'The email provider did not accept this message.' };
  }
}

async function sendEmail(args: SendArgs): Promise<boolean> {
  return (await sendEmailDetailed(args)).status === 'accepted';
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

export type PledgeEmailKind = 'thank_you' | 'donations_ready';

export function pledgeEmailSubject(kind: PledgeEmailKind): string {
  return kind === 'thank_you'
    ? 'Thank you for your pledge to Maiywa 4 Turbo 2027'
    : 'Donations are now ready — support Maiywa 4 Turbo 2027';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character] || character));
}

/**
 * Send one server-owned pledge message. The caller cannot supply arbitrary HTML,
 * recipients, or subjects, so the admin interface cannot become a mail relay.
 */
export async function sendPledgeEmail(params: {
  to: string;
  name: string;
  kind: PledgeEmailKind;
  donationUrl: string;
}): Promise<EmailSendOutcome & { subject: string }> {
  const firstName = params.name.trim().split(/\s+/)[0] || 'Supporter';
  const subject = pledgeEmailSubject(params.kind);
  const safeName = escapeHtml(firstName);
  const safeDonationUrl = escapeHtml(params.donationUrl);

  if (params.kind === 'thank_you') {
    const text = `Hi ${firstName},

Thank you for pledging your support to Maiywa 4 Turbo 2027. Your commitment means a great deal to our campaign and the communities we serve.

No payment has been taken. We will email you when donations are ready.

Kirgit, Kipkeleny Tulwo! 🇰🇪
— Isaac Kiptanui Maiywa for Turbo 2027`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0D0D0D"><div style="background:#0D0D0D;padding:20px;border-radius:12px 12px 0 0"><h2 style="color:#F5C100;margin:0">Maiywa 4 Turbo 2027</h2></div><div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px"><p>Hi ${safeName},</p><p>Thank you for pledging your support to <strong>Maiywa 4 Turbo 2027</strong>. Your commitment means a great deal to our campaign and the communities we serve.</p><p>No payment has been taken. We will email you when donations are ready.</p><p style="margin-top:24px">Together we rise! 🇰🇪<br>— Maiywa 4 Turbo 2027</p></div></div>`;
    return { ...(await sendEmailDetailed({ to: params.to, subject, text, html })), subject };
  }

  const text = `Hi ${firstName},

Thank you again for pledging your support to Isaac Kiptanui Maiywa for MP Turbo 2027.

Integration is done and donations are now ready. If you would like to support the campaign, please use our official donation page:
${params.donationUrl}

Thank you for standing with us. Kongoi mising!

Kirgit, Kipkeleny Tulwo! 🇰🇪
— Isaac Kiptanui Maiywa for Turbo 2027`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0D0D0D"><div style="background:#0D0D0D;padding:20px;border-radius:12px 12px 0 0"><h2 style="color:#F5C100;margin:0">Maiywa 4 Turbo 2027</h2></div><div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 12px 12px"><p>Hi ${safeName},</p><p>Thank you again for pledging your support to <strong>Maiywa 4 Turbo 2027</strong>.</p><p>Donations are now ready. If you would like to support the campaign, please use our official donation page:</p><p><a href="${safeDonationUrl}" style="display:inline-block;background:#1A7A3C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Donate to the campaign</a></p><p style="font-size:12px;color:#666">Or paste this link: ${safeDonationUrl}</p><p>Thank you for standing with us.</p><p style="margin-top:24px">Together we rise! 🇰🇪<br>— Maiywa 4 Turbo 2027</p></div></div>`;
  return { ...(await sendEmailDetailed({ to: params.to, subject, text, html })), subject };
}
