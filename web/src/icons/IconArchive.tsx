export function IconArchive(props: { size?: number; className?: string }) {
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
      <rect x="2.5" y="4" width="15" height="3.5" rx="1" />
      <path d="M4 7.5V15A1.5 1.5 0 0 0 5.5 16.5H14.5A1.5 1.5 0 0 0 16 15V7.5" />
      <path d="M10 9.5V13.5" />
      <path d="M8 11.5L10 13.5L12 11.5" />
    </svg>
  );
}
