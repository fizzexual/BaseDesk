export function IconInbox(props: { size?: number; className?: string }) {
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
      <rect x="3" y="5" width="14" height="11" rx="2" />
      <path d="M3 11.5H7L8.5 13.5H11.5L13 11.5H17" />
    </svg>
  );
}
