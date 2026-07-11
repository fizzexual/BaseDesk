import type { ButtonHTMLAttributes } from 'react';
import { cx } from './util';

const VARIANT = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  ghost: 'text-text-2 hover:bg-surface-2 hover:text-text',
  subtle: 'bg-surface-2 hover:bg-surface-3',
} as const;

const SIZE = {
  sm: 'h-8 gap-1.5 rounded-sm px-3 text-[13px]',
  md: 'h-9 gap-2 rounded-md px-3.5',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}
