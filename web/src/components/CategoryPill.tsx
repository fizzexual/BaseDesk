import { IconTag } from '../icons';
import { cx } from './util';
import { Tooltip } from './Tooltip';

/**
 * Shows the intake category a ticket was filed under — the type the customer picked
 * in the intake form (e.g. "Bug", "Technical"). Renders nothing when the ticket has
 * no category.
 */
export function CategoryPill({ category, className }: { category: string | null; className?: string }) {
  if (category === null || category.trim() === '') return null;
  return (
    <Tooltip title="Category" label="The type the customer picked when opening this ticket, via the intake form.">
      <span
        className={cx(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-3 px-2 py-0.5 text-[12px] font-medium text-text-2',
          className,
        )}
      >
        <IconTag size={12} className="shrink-0" />
        {category}
      </span>
    </Tooltip>
  );
}
