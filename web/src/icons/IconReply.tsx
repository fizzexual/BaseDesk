export function IconReply(props: { size?: number; className?: string }) {
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
      <path d="M8 5L3.5 9.5L8 14" />
      <path d="M3.5 9.5H12A4.5 4.5 0 0 1 16.5 14V16.5" />
    </svg>
  );
}
