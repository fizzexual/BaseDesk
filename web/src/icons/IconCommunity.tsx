export function IconCommunity(props: { size?: number; className?: string }) {
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
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h7A1.5 1.5 0 0 1 13 5.5v3A1.5 1.5 0 0 1 11.5 10H7l-3 2.5V10H4.5A1.5 1.5 0 0 1 3 8.5Z" />
      <path d="M13 8h2.5A1.5 1.5 0 0 1 17 9.5v3A1.5 1.5 0 0 1 15.5 14H15v2l-2.5-2H9.5" />
    </svg>
  );
}
