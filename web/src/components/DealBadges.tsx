import type { DealStage, DealType } from '../data/types';
import { cx } from './util';

const TYPE_STYLES: Record<DealType, { label: string; className: string }> = {
  expansion: { label: 'Expansion', className: 'bg-blue-bg text-blue' },
  retention: { label: 'Retention', className: 'bg-amber-bg text-amber' },
  inbound: { label: 'Inbound', className: 'bg-green-bg text-green' },
};

const STAGE_STYLES: Record<DealStage, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-blue-bg text-blue' },
  won: { label: 'Won', className: 'bg-green-bg text-green' },
  lost: { label: 'Lost', className: 'bg-surface-2 text-text-3' },
};

const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium';

export function DealTypeBadge({ type }: { type: DealType }) {
  const s = TYPE_STYLES[type];
  return <span className={cx(PILL, s.className)}>{s.label}</span>;
}

export function DealStageBadge({ stage }: { stage: DealStage }) {
  const s = STAGE_STYLES[stage];
  return <span className={cx(PILL, s.className)}>{s.label}</span>;
}
