import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { useApp } from '../../data/store';
import type { CustomFieldType } from '../../data/types';
import { IconTrash } from '../../icons';

const FIELD =
  'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2 placeholder:text-text-3';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  select: 'Dropdown',
  checkbox: 'Checkbox',
  date: 'Date',
};
const TYPES = Object.keys(TYPE_LABELS) as CustomFieldType[];

export function CustomFieldsSettings() {
  const fields = useApp((s) => s.customFields);
  const createCustomField = useApp((s) => s.createCustomField);
  const updateCustomField = useApp((s) => s.updateCustomField);
  const deleteCustomField = useApp((s) => s.deleteCustomField);

  const ticketFields = useMemo(
    () => fields.filter((f) => f.entity === 'ticket').sort((a, b) => a.position - b.position),
    [fields],
  );

  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsedOptions = optionsText
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter((o) => o !== '');
  const canAdd = label.trim() !== '' && (type !== 'select' || parsedOptions.length > 0);

  async function add() {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      await createCustomField({
        entity: 'ticket',
        label: label.trim(),
        type,
        required,
        ...(type === 'select' ? { options: parsedOptions } : {}),
      });
      setLabel('');
      setOptionsText('');
      setRequired(false);
      setType('text');
      toast('Field added');
    } catch {
      toast('Could not add the field');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    try {
      await deleteCustomField(id);
      toast(`Removed “${name}”`);
    } catch {
      toast('Could not remove the field');
    }
  }

  async function rename(id: string, next: string, current: string) {
    if (next.trim() === '' || next.trim() === current) return;
    try {
      await updateCustomField(id, { label: next.trim() });
    } catch {
      toast('Could not rename the field');
    }
  }

  return (
    <section>
      <h2 className="text-[15px] font-semibold">Ticket fields</h2>
      <p className="mt-2 text-[13px] text-text-3">
        Add your own fields to every ticket — an order number, a plan tier, a region. Agents fill them
        in from the ticket’s side panel.
      </p>

      {ticketFields.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2">
          {ticketFields.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
              <input
                defaultValue={f.label}
                aria-label={`Rename ${f.label}`}
                onBlur={(e) => void rename(f.id, e.target.value, f.label)}
                className="min-w-0 flex-1 rounded-sm bg-transparent text-[14px] font-medium outline-none focus:bg-surface-2 focus:px-1.5"
              />
              <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[12px] text-text-2">
                {TYPE_LABELS[f.type]}
              </span>
              {f.type === 'select' && f.options.length > 0 && (
                <span className="hidden max-w-[180px] truncate text-[12px] text-text-3 sm:inline">{f.options.join(', ')}</span>
              )}
              <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-2">
                Required
                <Switch
                  enabled={f.required}
                  onToggle={() => void updateCustomField(f.id, { required: !f.required })}
                  label={f.required ? 'Make optional' : 'Make required'}
                />
              </label>
              <Tooltip label={`Remove ${f.label}`}>
                <button
                  type="button"
                  aria-label={`Remove ${f.label}`}
                  onClick={() => void remove(f.id, f.label)}
                  className="shrink-0 rounded-sm p-1 text-text-3 transition-colors hover:bg-red-bg hover:text-red"
                >
                  <IconTrash size={15} />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 rounded-md border border-line p-3.5">
        <h3 className="text-[13px] font-semibold">Add a field</h3>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-[2] flex-col gap-1.5">
            <span className="text-[13px] font-medium">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Order number" className={FIELD} />
          </label>
          <label className="flex w-36 shrink-0 flex-col gap-1.5">
            <span className="text-[13px] font-medium">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className={FIELD}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
        </div>

        {type === 'select' && (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Options</span>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={'One per line, or comma-separated\nStarter\nPro\nEnterprise'}
              rows={3}
              className={cx(FIELD, 'h-auto py-2 leading-snug')}
            />
          </label>
        )}

        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-[13px] text-text-2">
            <Switch enabled={required} onToggle={() => setRequired((v) => !v)} label="Toggle required" />
            Required
          </label>
          <Button variant="primary" size="sm" onClick={() => void add()} disabled={!canAdd || busy}>
            {busy ? 'Adding…' : 'Add field'}
          </Button>
        </div>
      </div>
    </section>
  );
}
