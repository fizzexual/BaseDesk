import { createElement, type ComponentType, type ReactNode } from 'react';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export function EmptyState({
  icon,
  title,
  hint,
}: {
  /** Icon component (rendered at 28px) or an already-sized node. */
  icon: ReactNode | IconComponent;
  title: string;
  hint?: string;
}) {
  const iconNode = typeof icon === 'function' ? createElement(icon, { size: 28 }) : icon;
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-text-3">
        {iconNode}
      </div>
      <div className="mt-4 text-[14px] font-medium text-text">{title}</div>
      {hint ? <div className="mt-1 text-[13px] text-text-3">{hint}</div> : null}
    </div>
  );
}
