export function IconBell(props: { size?: number; className?: string }) {
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
      <path d="M6 8a4 4 0 0 1 8 0c0 3.5 1 5 1.5 5.5h-11C5 13 6 11.5 6 8Z" />
      <path d="M8.5 16a1.75 1.75 0 0 0 3 0" />
    </svg>
  );
}
