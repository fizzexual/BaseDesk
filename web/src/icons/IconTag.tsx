export function IconTag(props: { size?: number; className?: string }) {
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
      <path d="M3.5 10V3.5H10L16.5 10L10 16.5Z" />
      <circle cx="7" cy="7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
