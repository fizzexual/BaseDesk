import type { ReactNode } from 'react';
import { cx } from './util';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-md bg-surface-2 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={cx(
              'inline-flex h-full items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-colors',
              active ? 'bg-surface text-text shadow-1' : 'text-text-2 hover:text-text',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
