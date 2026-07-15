export function IconClipboard(props: { size?: number; className?: string }) {
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
      <rect x="4.5" y="4.5" width="11" height="13" rx="2" />
      <rect x="7.5" y="2.5" width="5" height="3" rx="1" />
      <path d="M8 10h4" />
      <path d="M8 13h4" />
    </svg>
  );
}
