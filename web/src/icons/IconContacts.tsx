export function IconContacts(props: { size?: number; className?: string }) {
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
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <circle cx="7" cy="8.5" r="1.5" />
      <path d="M4.5 13A2.5 2.5 0 0 1 9.5 13" />
      <path d="M12 8.5H15" />
      <path d="M12 11.5H15" />
    </svg>
  );
}
