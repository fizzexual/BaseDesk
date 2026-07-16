export function IconTeam(props: { size?: number; className?: string }) {
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
      <circle cx="11.5" cy="7.5" r="2.7" />
      <path d="M6 17c.4-2.9 2.6-4.7 5.5-4.7s5.1 1.8 5.5 4.7" />
      <circle cx="5" cy="7.2" r="1.9" />
      <path d="M2.3 15.4c.3-1.9 1.4-3.2 3-3.6" />
    </svg>
  );
}
