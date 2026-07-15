export function IconActivity(props: { size?: number; className?: string }) {
  // A heartbeat/pulse line — the conventional "status / uptime" glyph.
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
      <path d="M2 10h4l2-5 2 10 2-5h6" />
    </svg>
  );
}
