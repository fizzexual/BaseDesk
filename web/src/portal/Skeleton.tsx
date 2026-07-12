import { cx } from '../components/util';

/** A single subtle pulsing placeholder block. Compose these into content-shaped
 * skeletons for loading states. Decorative, so it is hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded bg-surface-2', className)} />;
}
