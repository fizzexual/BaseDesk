import { useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';
import type { ImportResult, ImportType } from '../../data/types';
import { IconImport } from '../../icons';

const SAMPLE: Record<ImportType, string> = {
  contacts: 'Name,Email,Company',
  tickets: 'Subject,Requester email,Message,Priority,Status,Tags',
};

const SELECT_CLASS = 'h-9 w-full rounded-sm border border-line bg-surface px-2 text-[13px]';

export function ImportSettings() {
  const importData = useApp((s) => s.importData);
  const [type, setType] = useState<ImportType>('contacts');
  const [csv, setCsv] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setResult(null);
    setOverrides({});
    setCommitted(false);
  }
  function changeType(t: ImportType) {
    setType(t);
    reset();
  }

  async function preview(ov = overrides) {
    if (csv.trim() === '' || busy) return;
    setBusy(true);
    try {
      const r = await importData({ type, csv, mapping: ov, dryRun: true });
      setResult(r);
      setCommitted(false);
    } catch {
      toast('Could not read the CSV');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await importData({ type, csv, mapping: overrides, dryRun: false });
      setResult(r);
      setCommitted(true);
      if (r.error === undefined) toast(`Imported ${r.created} ${type === 'contacts' ? 'contact(s)' : 'ticket(s)'}`);
    } catch {
      toast('Import failed');
    } finally {
      setBusy(false);
    }
  }

  function setField(key: string, header: string) {
    const next = { ...overrides, [key]: header };
    setOverrides(next);
    void preview(next);
  }

  function onFile(files: FileList | null) {
    const f = files?.[0];
    if (f === undefined) return;
    void f.text().then((text) => {
      setCsv(text);
      reset();
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  const headers = result?.headers ?? [];
  const canImport = result !== null && result.error === undefined && !committed && result.created > 0;

  return (
    <section>
      <h2 className="text-[15px] font-semibold">Import from CSV</h2>
      <p className="mt-1 text-[13px] text-text-3">
        Bring contacts or tickets over from another tool. Export a CSV from Zendesk, Freshdesk, a spreadsheet — anything —
        then map its columns below. Preview before you commit.
      </p>

      <div className="mt-4">
        <SegmentedControl<ImportType>
          options={[
            { value: 'contacts', label: 'Contacts' },
            { value: 'tickets', label: 'Tickets' },
          ]}
          value={type}
          onChange={changeType}
        />
      </div>

      <label className="mt-4 block text-[13px] font-medium" htmlFor="import-csv">
        CSV data
      </label>
      <textarea
        id="import-csv"
        value={csv}
        rows={7}
        spellCheck={false}
        placeholder={`${SAMPLE[type]}\n…`}
        className="mt-1.5 w-full resize-y rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed placeholder:text-text-3"
        onChange={(e) => {
          setCsv(e.target.value);
          reset();
        }}
      />
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files)} />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="subtle" size="sm" onClick={() => fileRef.current?.click()}>
          <IconImport size={15} />
          Load .csv file
        </Button>
        <Button size="sm" disabled={csv.trim() === '' || busy} onClick={() => void preview()}>
          {busy ? 'Reading…' : 'Preview'}
        </Button>
      </div>

      {result !== null && (
        <div className="mt-6 border-t border-line pt-5">
          <div className="text-[13px] font-medium">Map columns</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {result.fields.map((f) => (
              <div key={f.key} className="grid grid-cols-[130px_1fr] items-center gap-3">
                <label className="text-[13px] text-text-2" htmlFor={`map-${f.key}`}>
                  {f.label}
                  {f.required && <span className="text-red"> *</span>}
                </label>
                <select
                  id={`map-${f.key}`}
                  className={SELECT_CLASS}
                  value={result.mapping[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  <option value="">— skip —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {result.error !== undefined ? (
            <div className="mt-4 rounded-md border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">{result.error}</div>
          ) : (
            <div className="mt-4 rounded-md bg-surface-2 px-3 py-2.5 text-[13px]">
              {committed ? (
                <span>
                  Imported <b className="text-green">{result.created}</b> of {result.rowCount} rows.
                </span>
              ) : (
                <span>
                  Ready to import <b>{result.created}</b> of {result.rowCount} rows.
                </span>
              )}
              {result.skippedCount > 0 && <span className="text-text-3"> · {result.skippedCount} skipped</span>}
              {result.errorCount > 0 && <span className="text-red"> · {result.errorCount} with errors</span>}
            </div>
          )}

          {(result.errors.length > 0 || result.skipped.length > 0) && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-line text-[12px]">
              {result.errors.map((e) => (
                <div key={`e${e.row}`} className="flex gap-2 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="shrink-0 text-text-3 tabular-nums">Row {e.row}</span>
                  <span className="text-red">{e.reason}</span>
                </div>
              ))}
              {result.skipped.map((s) => (
                <div key={`s${s.row}`} className="flex gap-2 border-b border-line px-3 py-1.5 last:border-0">
                  <span className="shrink-0 text-text-3 tabular-nums">Row {s.row}</span>
                  <span className="text-text-2">skipped — {s.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            {committed ? (
              <Button variant="subtle" size="sm" onClick={reset}>
                Import another file
              </Button>
            ) : (
              <Button size="sm" disabled={!canImport || busy} onClick={() => void commit()}>
                {busy
                  ? 'Importing…'
                  : `Import ${result.created} ${type === 'contacts' ? 'contact' : 'ticket'}${result.created === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
