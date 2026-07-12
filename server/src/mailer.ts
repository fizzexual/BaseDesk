// Builds and sends transactional emails through the raw SMTP client. The only
// notification today is "an agent replied to your ticket", with a link back to
// the customer portal.

import { sendMail, type OutgoingMail, type SmtpTransport } from './smtp.js';
import type { SmtpConfig } from './types.js';

/** True when SMTP is switched on and has the minimum config to send. */
export function smtpReady(cfg: SmtpConfig): boolean {
  return cfg.enabled && cfg.host.trim() !== '' && cfg.fromEmail.trim() !== '';
}

function transportOf(cfg: SmtpConfig): SmtpTransport {
  return { host: cfg.host.trim(), port: cfg.port, secure: cfg.secure, user: cfg.user.trim(), pass: cfg.pass };
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export interface ReplyEmailOpts {
  toEmail: string;
  toName: string;
  ticketNumber: number;
  subject: string;
  body: string;
  ticketUrl: string;
}

/** The email a customer receives when support replies. */
export function replyEmail(cfg: SmtpConfig, opts: ReplyEmailOpts): OutgoingMail {
  const text = [
    `Hi ${firstName(opts.toName)},`,
    '',
    `You have a new reply on your ticket "${opts.subject}" (#${opts.ticketNumber}):`,
    '',
    opts.body,
    '',
    `View and reply: ${opts.ticketUrl}`,
    '',
    `— ${cfg.fromName}`,
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#171a19">',
    `<p style="font-size:15px">Hi ${escapeHtml(firstName(opts.toName))},</p>`,
    `<p style="font-size:14px;color:#5c6461">You have a new reply on your ticket <strong>${escapeHtml(opts.subject)}</strong> (#${opts.ticketNumber}):</p>`,
    `<div style="white-space:pre-wrap;border:1px solid #e5e9e7;border-radius:10px;background:#f6f8f7;padding:14px 16px;font-size:14px;line-height:1.55">${escapeHtml(opts.body)}</div>`,
    `<p style="margin-top:20px"><a href="${escapeHtml(opts.ticketUrl)}" style="display:inline-block;background:#171a19;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">View and reply</a></p>`,
    `<p style="font-size:12px;color:#68716d;margin-top:24px">— ${escapeHtml(cfg.fromName)}</p>`,
    '</div>',
  ].join('');

  return {
    from: { name: cfg.fromName, email: cfg.fromEmail },
    to: opts.toEmail,
    subject: `Re: ${opts.subject} [#${opts.ticketNumber}]`,
    text,
    html,
  };
}

export async function sendReplyNotification(cfg: SmtpConfig, opts: ReplyEmailOpts): Promise<void> {
  await sendMail(transportOf(cfg), replyEmail(cfg, opts));
}

/** A plain "it works" message for the Send-test-email button. */
export async function sendTestEmail(cfg: SmtpConfig, to: string): Promise<void> {
  await sendMail(transportOf(cfg), {
    from: { name: cfg.fromName, email: cfg.fromEmail },
    to,
    subject: 'BaseDesk email test',
    text: 'This is a test email from BaseDesk. If you are reading this, SMTP is configured correctly.',
    html: '<p style="font-family:system-ui,sans-serif;font-size:14px">This is a test email from BaseDesk. If you are reading this, SMTP is configured correctly.</p>',
  });
}
