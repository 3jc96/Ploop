/**
 * Send plain-text email to all addresses in ADMIN_EMAILS (comma-separated).
 * Same transport as suggestion alerts; requires SMTP_* env vars.
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Send a single email to one recipient. Returns true on success. */
export async function sendEmailToUser(to: string, subject: string, text: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !to) return false;
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
    const from = process.env.SMTP_FROM || user || 'noreply@ploop.app';
    await transporter.sendMail({ from, to, subject, text });
    return true;
  } catch (e) {
    console.error('[Email] Send to user failed:', e);
    return false;
  }
}

/** Returns true if at least one message was handed to SMTP; false if skipped or failed. */
export async function sendEmailToAdmins(subject: string, text: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const recipients = getAdminEmails();

  if (!host || !user || !pass) {
    console.log(
      '[AdminEmail] SMTP not configured. Skipping email. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env'
    );
    return false;
  }
  if (recipients.length === 0) {
    console.log('[AdminEmail] ADMIN_EMAILS empty. Skipping email.');
    return false;
  }

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ploop.app';
    for (const to of recipients) {
      if (to) await transporter.sendMail({ from, to, subject, text });
    }
    return true;
  } catch (e) {
    console.error('[AdminEmail] Send failed:', e);
    return false;
  }
}
