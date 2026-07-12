export function IconList(props: { size?: number; className?: string }) {
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
      <path d="M7 5.5h10M7 10h10M7 14.5h10" />
      <circle cx="3.5" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
