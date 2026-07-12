export function IconChannels(props: { size?: number; className?: string }) {
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
      <circle cx="10" cy="10" r="2.5" />
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="16" cy="4" r="1.6" />
      <circle cx="4" cy="16" r="1.6" />
      <circle cx="16" cy="16" r="1.6" />
      <path d="M5.2 5.2 8.2 8.2M14.8 5.2 11.8 8.2M5.2 14.8 8.2 11.8M14.8 14.8 11.8 11.8" />
    </svg>
  );
}
