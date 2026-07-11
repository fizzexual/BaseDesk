export function IconUserPlus(props: { size?: number; className?: string }) {
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
      <circle cx="8" cy="6.5" r="3" />
      <path d="M3 16.5A5 5 0 0 1 13 16.5" />
      <path d="M15.5 5V9" />
      <path d="M13.5 7H17.5" />
    </svg>
  );
}
