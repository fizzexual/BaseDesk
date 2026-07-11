export function IconPaperclip(props: { size?: number; className?: string }) {
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
      <path d="M13.5 5.5V13A3.5 3.5 0 0 1 6.5 13V6A2.25 2.25 0 0 1 11 6V12.5A1.25 1.25 0 0 1 8.5 12.5V7.5" />
    </svg>
  );
}
