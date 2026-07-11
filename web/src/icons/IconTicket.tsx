export function IconTicket(props: { size?: number; className?: string }) {
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
      <path d="M4 5H16A1.5 1.5 0 0 1 17.5 6.5V8.5A1.5 1.5 0 0 0 17.5 11.5V13.5A1.5 1.5 0 0 1 16 15H4A1.5 1.5 0 0 1 2.5 13.5V11.5A1.5 1.5 0 0 0 2.5 8.5V6.5A1.5 1.5 0 0 1 4 5Z" />
      <path strokeLinecap="butt" d="M13 5V6.5" />
      <path strokeLinecap="butt" d="M13 9.25V10.75" />
      <path strokeLinecap="butt" d="M13 13.5V15" />
    </svg>
  );
}
