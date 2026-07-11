export function IconChevronsUp(props: { size?: number; className?: string }) {
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
      <path d="M6 9.5L10 5.5L14 9.5" />
      <path d="M6 14.5L10 10.5L14 14.5" />
    </svg>
  );
}
