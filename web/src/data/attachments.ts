import type { Attachment } from './types';

// In demo mode there is no server to serve /api/attachments, so the LocalRepository
// registers object URLs here and attachmentUrl() prefers them.
const localUrls = new Map<string, string>();

export function registerLocalAttachment(id: string, url: string): void {
  localUrls.set(id, url);
}

export function attachmentUrl(att: Attachment): string {
  return localUrls.get(att.id) ?? `/api/attachments/${encodeURIComponent(att.id)}`;
}

/** Images we preview inline in the thread (SVG excluded — it can carry script). */
export function isImage(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') && att.mimeType !== 'image/svg+xml';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
