// A small, dependency-free SMTP client built on node:net / node:tls. Supports
// implicit TLS (port 465), STARTTLS (587, when the server advertises it), plain
// connections (25 / localhost), and AUTH LOGIN. Enough to deliver transactional
// notification emails through any standard SMTP provider — no nodemailer needed.

import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

export class SmtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpError';
  }
}

export interface SmtpTransport {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS from the start (port 465)
  user: string;
  pass: string;
}

export interface OutgoingMail {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Reads CRLF-terminated SMTP replies (handling multi-line 250- continuations). */
class Reader {
  private buf = '';
  private pending: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null;

  constructor(private socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => {
      this.buf += d;
      this.drain();
    });
    socket.on('error', (e) => this.pending?.reject(e));
    socket.on('close', () => this.pending?.reject(new SmtpError('connection closed')));
  }

  detach(): void {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
  }

  private drain(): void {
    if (this.pending === null) return;
    const lines = this.buf.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      // A complete reply ends on a line like "250 message" (space, not dash).
      if (/^\d{3} /.test(lines[i])) {
        const code = Number(lines[i].slice(0, 3));
        const text = lines.slice(0, i + 1).join(' ');
        this.buf = lines.slice(i + 1).join('\r\n');
        const p = this.pending;
        this.pending = null;
        p.resolve({ code, text });
        return;
      }
    }
  }

  read(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.drain();
    });
  }
}

function connect(transport: SmtpTransport): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const onErr = (e: Error) => reject(e);
    const socket = transport.secure
      ? tls.connect({ host: transport.host, port: transport.port, servername: transport.host }, () => resolve(socket))
      : net.connect({ host: transport.host, port: transport.port }, () => resolve(socket));
    socket.once('error', onErr);
    socket.setTimeout(15_000, () => reject(new SmtpError('connection timed out')));
  });
}

function upgradeTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket, servername: host }, () => resolve(t));
    t.once('error', reject);
  });
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** RFC 2047 encode a header value only when it has non-ASCII characters. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

/** One address, nothing else: no spaces, control characters, angle brackets or quotes. */
// eslint-disable-next-line no-control-regex
const SAFE_ADDRESS = /^[^\s<>"@\x00-\x1f\x7f]+@[^\s<>"@\x00-\x1f\x7f]+$/;
export const isSafeAddress = (a: string): boolean => SAFE_ADDRESS.test(a);

/** A header value on one line: a CR or LF would start a new header (header injection). */
const oneLine = (v: string): string => v.replace(/[\r\n]+/g, ' ');

export function buildMessage(mail: OutgoingMail): string {
  const boundary = `bd_${randomUUID().replace(/-/g, '')}`;
  const domain = mail.from.email.split('@')[1] ?? 'basedesk.local';
  // Normalise every line ending (a lone CR too, the SMTP-smuggling trick) before dot-stuffing.
  const dotStuff = (body: string): string => body.replace(/\r\n|\r|\n/g, '\r\n').replace(/^\./gm, '..');
  const headers = [
    `From: ${encodeHeader(oneLine(mail.from.name))} <${mail.from.email}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(oneLine(mail.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    dotStuff(mail.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return `${headers}\r\n\r\n${body}`;
}

/** Connects, authenticates, and delivers one message. Throws SmtpError on any failure. */
export async function sendMail(transport: SmtpTransport, mail: OutgoingMail): Promise<void> {
  // Checked before connecting: these go into MAIL FROM / RCPT TO verbatim.
  if (!isSafeAddress(mail.to)) throw new SmtpError('invalid recipient address');
  if (!isSafeAddress(mail.from.email)) throw new SmtpError('invalid sender address');
  let socket = await connect(transport);
  let reader = new Reader(socket);

  const expect = async (ok: number[], label: string) => {
    const r = await reader.read();
    if (!ok.includes(r.code)) throw new SmtpError(`${label}: ${r.text}`);
    return r;
  };
  const cmd = async (line: string, ok: number[], label: string) => {
    socket.write(`${line}\r\n`);
    return expect(ok, label);
  };

  try {
    await expect([220], 'greeting');
    const ehlo = await cmd(`EHLO basedesk`, [250], 'EHLO');

    if (!transport.secure && /STARTTLS/i.test(ehlo.text)) {
      await cmd('STARTTLS', [220], 'STARTTLS');
      reader.detach();
      socket = await upgradeTls(socket, transport.host);
      reader = new Reader(socket);
      await cmd(`EHLO basedesk`, [250], 'EHLO (tls)');
    }

    if (transport.user !== '') {
      await cmd('AUTH LOGIN', [334], 'AUTH');
      await cmd(b64(transport.user), [334], 'AUTH user');
      await cmd(b64(transport.pass), [235], 'AUTH password');
    }

    await cmd(`MAIL FROM:<${mail.from.email}>`, [250], 'MAIL FROM');
    await cmd(`RCPT TO:<${mail.to}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    socket.write(`${buildMessage(mail)}\r\n.\r\n`);
    await expect([250], 'message body');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
    socket.destroy();
  }
}
