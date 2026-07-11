import { useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import type { Deal, DealStage, DealType } from '../../data/types';
import { parseMoney } from '../../data/money';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { SegmentedControl } from '../../components/SegmentedControl';
import { toast } from '../../components/Toast';

const TYPE_OPTIONS: { value: DealType; label: string }[] = [
  { value: 'expansion', label: 'Expansion' },
  { value: 'retention', label: 'Retention' },
  { value: 'inbound', label: 'Inbound' },
];
const STAGE_OPTIONS: { value: DealStage; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const FIELD = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none focus:border-line-2';
const LABEL = 'mb-1.5 block text-[13px] font-medium text-text-2';

export function DealDialog({
  open,
  onClose,
  deal,
  presetContactId,
  presetTicketId,
}: {
  open: boolean;
  onClose: () => void;
  deal?: Deal;
  presetContactId?: string;
  presetTicketId?: string | null;
}) {
  const contacts = useApp((s) => s.contacts);
  const agents = useApp((s) => s.agents);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const createDeal = useApp((s) => s.createDeal);
  const updateDeal = useApp((s) => s.updateDeal);
  const deleteDeal = useApp((s) => s.deleteDeal);

  const editing = deal !== undefined;

  const [title, setTitle] = useState(deal?.title ?? '');
  const [type, setType] = useState<DealType>(deal?.type ?? 'expansion');
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? 'open');
  const [valueStr, setValueStr] = useState(deal ? String(deal.value / 100) : '');
  const [contactId, setContactId] = useState(deal?.contactId ?? presetContactId ?? '');
  const [ownerId, setOwnerId] = useState(deal?.ownerId ?? currentAgentId);
  const [note, setNote] = useState(deal?.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const contactLocked = !editing && presetContactId !== undefined;
  const contactList = useMemo(
    () => Object.values(contacts).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );
  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const cents = parseMoney(valueStr);
  const valid = title.trim() !== '' && cents !== null && cents >= 0 && contactId !== '';

  async function save() {
    if (!valid || cents === null) return;
    try {
      if (editing) {
        await updateDeal(deal.id, { title: title.trim(), type, stage, value: cents, ownerId, note });
      } else {
        await createDeal({
          title: title.trim(),
          type,
          value: cents,
          contactId,
          ticketId: presetTicketId ?? null,
          ownerId,
          note,
        });
        toast('Opportunity logged');
      }
      onClose();
    } catch {
      toast('Could not save the deal');
    }
  }

  async function remove() {
    if (!editing) return;
    try {
      await deleteDeal(deal.id);
      toast('Deal deleted');
      onClose();
    } catch {
      toast('Could not delete the deal');
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit deal' : 'Log opportunity'} width={460}>
      <div className="flex flex-col gap-3.5">
        <div>
          <label className={LABEL} htmlFor="deal-title">Title</label>
          <input
            id="deal-title"
            className={FIELD}
            placeholder="Upgrade to Business — 4 seats"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <span className={LABEL}>Type</span>
          <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={setType} />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className={LABEL} htmlFor="deal-value">Value</label>
            <input
              id="deal-value"
              inputMode="decimal"
              className={FIELD}
              placeholder="$1,200"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className={LABEL} htmlFor="deal-owner">Owner</label>
            <select id="deal-owner" className={FIELD} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {agentList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={LABEL} htmlFor="deal-contact">Customer</label>
          <select
            id="deal-contact"
            className={FIELD}
            value={contactId}
            disabled={contactLocked || editing}
            onChange={(e) => setContactId(e.target.value)}
          >
            <option value="" disabled>Select a contact…</option>
            {contactList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.company !== null ? ` · ${c.company}` : ''}
              </option>
            ))}
          </select>
        </div>

        {editing && (
          <div>
            <span className={LABEL}>Stage</span>
            <SegmentedControl options={STAGE_OPTIONS} value={stage} onChange={setStage} />
          </div>
        )}

        <div>
          <label className={LABEL} htmlFor="deal-note">Note</label>
          <textarea
            id="deal-note"
            className="min-h-[68px] w-full resize-none rounded-md border border-line bg-bg px-2.5 py-2 text-[14px] outline-none focus:border-line-2"
            placeholder="Context for the team…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="mt-1 flex items-center justify-between">
          {editing ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-[13px] text-text-2">
                Delete?
                <button type="button" className="font-medium text-red hover:underline" onClick={remove}>Yes</button>
                <button type="button" className="text-text-3 hover:text-text" onClick={() => setConfirmDelete(false)}>No</button>
              </span>
            ) : (
              <button type="button" className="text-[13px] font-medium text-red hover:underline" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!valid} onClick={save}>
              {editing ? 'Save' : 'Log deal'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
