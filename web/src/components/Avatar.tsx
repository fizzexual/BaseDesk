import type { CSSProperties } from 'react';
import { cx } from './util';

export function Avatar({
  name,
  hue,
  size = 28,
  className,
}: {
  name: string;
  hue: number;
  size?: number;
  className?: string;
}) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        'bg-[hsl(var(--av-hue)_45%_45%)] [[data-theme=dark]_&]:bg-[hsl(var(--av-hue)_40%_55%)]',
        className,
      )}
      style={
        {
          '--av-hue': String(hue),
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
        } as CSSProperties
      }
    >
      {initial}
    </span>
  );
}
