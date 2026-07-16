export function IconGraph(props: { size?: number; className?: string }) {
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
      <path d="M6.8 8.4 4.4 12.6M11.4 6.6 8 8M12.2 8.6l2 2.6" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="3.5" cy="14" r="1.6" />
      <circle cx="14" cy="5.5" r="1.6" />
      <circle cx="15" cy="12.5" r="1.8" />
    </svg>
  );
}
