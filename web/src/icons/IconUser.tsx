export function IconUser(props: { size?: number; className?: string }) {
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
      <circle cx="10" cy="6.5" r="3" />
      <path d="M4 17c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
    </svg>
  );
}
