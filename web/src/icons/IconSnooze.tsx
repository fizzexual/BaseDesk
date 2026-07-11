export function IconSnooze(props: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={props.size ?? 20}
      height={props.size ?? 20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className}
    >
      <path d="M8.5 6A4 4 0 0 0 14 11.5A5.5 5.5 0 1 1 8.5 6Z" />
      <path d="M13.5 3H17L13.5 7H17" />
    </svg>
  );
}
