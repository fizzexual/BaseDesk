export function IconRevenue(props: { size?: number; className?: string }) {
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
      <path d="M3 13.5 8 8.5l3 3 5.5-5.5" />
      <path d="M12 6h4.5V10.5" />
    </svg>
  );
}
