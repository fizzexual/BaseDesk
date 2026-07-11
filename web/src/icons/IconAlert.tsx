export function IconAlert(props: { size?: number; className?: string }) {
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
      <path d="M10 3.5L17 16H3Z" />
      <path d="M10 8V11.5" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
