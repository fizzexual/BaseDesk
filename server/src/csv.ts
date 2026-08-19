// A small RFC-4180-ish CSV parser — no dependency. Handles quoted fields,
// escaped quotes (""), and commas / newlines embedded inside quotes.

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
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Quote a single CSV cell when it contains a comma, quote, or newline — and defuse
 * spreadsheet formula injection. Ticket subjects and contact names come from customers,
 * so a value starting with = + - @ (or a leading tab/CR) would run as a live formula
 * when an agent opens the export in Excel or Sheets. A leading apostrophe makes the
 * cell literal text; every major spreadsheet honours it and hides it on display.
 */
function csvCell(value: string | number | null): string {
  let s = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize a header row + data rows to CSV text (CRLF line endings, RFC-4180). */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return lines.join('\r\n');
}

/**
 * Parse CSV text into a header list and an array of row objects keyed by header.
 * Fully blank lines are dropped; values are trimmed.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = parseRecords(text);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (r[i] ?? '').trim();
      });
      return obj;
    });
  return { headers, rows };
}
