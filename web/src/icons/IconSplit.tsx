export function IconSplit(props: { size?: number; className?: string }) {
  // One node on the left forking into two on the right — the inverse of the merge glyph.
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
      <circle cx="5" cy="10" r="1.75" />
      <circle cx="15" cy="5" r="1.75" />
      <circle cx="15" cy="15" r="1.75" />
      <path d="M6.75 10h1.75c1.2 0 1.85-.7 2.5-1.6l1.1-1.5" />
      <path d="M6.75 10h1.75c1.2 0 1.85.7 2.5 1.6l1.1 1.5" />
    </svg>
  );
}
