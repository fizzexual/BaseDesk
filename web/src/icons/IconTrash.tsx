export function IconTrash(props: { size?: number; className?: string }) {
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
      <path d="M3.5 5.5H16.5" />
      <path d="M7.5 5.5V5A1.5 1.5 0 0 1 9 3.5H11A1.5 1.5 0 0 1 12.5 5V5.5" />
      <path d="M5 5.5V15A1.5 1.5 0 0 0 6.5 16.5H13.5A1.5 1.5 0 0 0 15 15V5.5" />
      <path d="M8.5 9.5V13" />
      <path d="M11.5 9.5V13" />
    </svg>
  );
}
