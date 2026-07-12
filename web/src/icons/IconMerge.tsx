export function IconMerge(props: { size?: number; className?: string }) {
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
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="15" r="2" />
      <circle cx="15" cy="10" r="2" />
      <path d="M6 7v6" />
      <path d="M8 5h1a4 4 0 0 1 4 4M8 15h1a4 4 0 0 0 4-4" />
    </svg>
  );
}
