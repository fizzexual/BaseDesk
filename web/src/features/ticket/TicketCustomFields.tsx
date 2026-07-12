import { useMemo } from 'react';
import { useApp } from '../../data/store';
import { Switch } from '../../components/Switch';
import { toast } from '../../components/Toast';
import type { CustomFieldDef, Ticket } from '../../data/types';

const INPUT =
  'w-full rounded-md border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-line-2 placeholder:text-text-3';

function FieldControl({
  field,
  value,
  onCommit,
}: {
  field: CustomFieldDef;
  value: string;
  onCommit: (v: string) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <Switch
        enabled={value === 'true'}
        onToggle={() => onCommit(value === 'true' ? 'false' : 'true')}
        label={`Toggle ${field.label}`}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <select value={value} onChange={(e) => onCommit(e.target.value)} className={INPUT}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  if (field.type === 'textarea') {
    return (
      <textarea
        defaultValue={value}
        rows={2}
        onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
        className={`${INPUT} leading-snug`}
        placeholder="—"
      />
    );
  }
  return (
    <input
      type={type}
      defaultValue={value}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      className={`${INPUT} tabular-nums`}
      placeholder="—"
    />
  );
}

export function TicketCustomFields({ ticket }: { ticket: Ticket }) {
  const allFields = useApp((s) => s.customFields);
  const setTicketField = useApp((s) => s.setTicketField);

  const fields = useMemo(
    () => allFields.filter((f) => f.entity === 'ticket').sort((a, b) => a.position - b.position),
    [allFields],
  );

  if (fields.length === 0) return null;

  function commit(fieldId: string, value: string) {
    setTicketField(ticket.id, fieldId, value).catch(() => toast('Could not save the field'));
  }

  return (
    <section className="border-t border-line p-4">
      <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-3">Details</h3>
      <div className="flex flex-col gap-2.5">
        {fields.map((f) => {
          const value = ticket.customFields[f.id] ?? '';
          const showRequired = f.required && value.trim() === '' && f.type !== 'checkbox';
          return (
            <label key={f.id} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-3">
                {f.label}
                {showRequired && <span className="text-[11px] font-normal text-amber">required</span>}
              </span>
              <FieldControl field={f} value={value} onCommit={(v) => commit(f.id, v)} />
            </label>
          );
        })}
      </div>
    </section>
  );
}
