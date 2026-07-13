// Client-side CSV import helpers, used by the demo LocalRepository so import
// works without a server. The real ApiRepository does this on the server;
// these mirror server/src/csv.ts + the /api/import mapping logic exactly.

import type { ImportField, ImportType } from './types';

export const IMPORT_FIELDS: Record<ImportType, ImportField[]> = {
  contacts: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', required: true },
    { key: 'company', label: 'Company', required: false },
  ],
  tickets: [
    { key: 'subject', label: 'Subject', required: true },
    { key: 'requesterEmail', label: 'Requester email', required: true },
    { key: 'body', label: 'Message', required: false },
    { key: 'priority', label: 'Priority', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'tags', label: 'Tags', required: false },
  ],
};

export const IMPORT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normHeader = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize a header row + data rows to CSV text (RFC-4180, CRLF). */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}

function parseRecords(text: string): string[][] {
  const rows: string[][] = [];
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = parseRecords(text);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
  return { headers, rows };
}

export function autoMapColumns(type: ImportType, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of IMPORT_FIELDS[type]) {
    const target = normHeader(f.key);
    const label = normHeader(f.label);
    let h = headers.find((x) => normHeader(x) === target || normHeader(x) === label);
    if (h === undefined) h = headers.find((x) => { const n = normHeader(x); return n !== '' && (n.includes(target) || target.includes(n)); });
    if (h === undefined && f.key === 'requesterEmail') h = headers.find((x) => normHeader(x).includes('email'));
    if (h === undefined && f.key === 'body') h = headers.find((x) => ['message', 'description', 'body', 'comment'].some((a) => normHeader(x).includes(a)));
    if (h !== undefined) map[f.key] = h;
  }
  return map;
}
