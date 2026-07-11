export function IconNote(props: { size?: number; className?: string }) {
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
      <path d="M12 3.5H5.5A1.5 1.5 0 0 0 4 5V15A1.5 1.5 0 0 0 5.5 16.5H14.5A1.5 1.5 0 0 0 16 15V7.5Z" />
      <path d="M12 3.5V6A1.5 1.5 0 0 0 13.5 7.5H16" />
      <path d="M7 10.5H13" />
      <path d="M7 13H10.5" />
    </svg>
  );
}
