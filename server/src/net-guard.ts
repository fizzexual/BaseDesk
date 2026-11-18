// Guard for every URL the server fetches on an admin's say-so (AI provider, channel
// outbound endpoints, webhooks).
//
// Loopback and private LAN addresses stay allowed on purpose: a local Ollama or an
// in-house relay is a normal setup for a self-hosted helpdesk. What is always refused is
// the link-local range, where cloud metadata services hand out instance credentials
// (169.254.169.254 and friends), and the "this host" address 0.0.0.0. Redirects are not
// followed by callers, so a public URL cannot bounce the request into those ranges.
//
// Known limit: the address is checked at lookup time, so DNS rebinding between this
// check and the fetch is not covered.

import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const inV4 = (ip: string, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

/** True for an address no outbound request may reach. */
export function isBlockedAddress(address: string): boolean {
  let ip = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    return (
      inV4(ip, '169.254.0.0', 16) || // link-local: AWS/GCP/Azure metadata, ECS task credentials
      inV4(ip, '0.0.0.0', 8) || // "this host"
      ip === '100.100.100.200' // Alibaba Cloud metadata
    );
  }
  if (net.isIPv6(ip)) {
    return (
      ip === '::' ||
      /^fe[89ab][0-9a-f]:/.test(ip) || // fe80::/10 link-local
      ip === 'fd00:ec2::254' // AWS IPv6 metadata
    );
  }
  return true; // not an IP at all: refuse rather than guess
}

/** Parses and checks an outbound URL. Throws BlockedUrlError with a plain reason. */
export async function assertOutboundUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Only http and https URLs are allowed.');
  if (url.username !== '' || url.password !== '') throw new BlockedUrlError('Put credentials in the settings, not in the URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (net.isIP(host) !== 0) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new BlockedUrlError(`Could not resolve ${host}.`);
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new BlockedUrlError('That address is not allowed (cloud metadata and link-local addresses are blocked).');
  }
  return url;
}
