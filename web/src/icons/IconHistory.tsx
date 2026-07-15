export function IconHistory(props: { size?: number; className?: string }) {
  // Canonical "history" glyph (clock + rewind arrow). Drawn in a 24 viewBox,
  // so the stroke is bumped to 1.8 to match the 1.5-in-20 weight of the set.
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? 20}
      height={props.size ?? 20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className}
    >
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
