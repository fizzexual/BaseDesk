export function IconKeyboard(props: { size?: number; className?: string }) {
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
      <rect x="2.5" y="5.5" width="15" height="9" rx="2" />
      <circle cx="5.5" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="11.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="11.5" r="0.8" fill="currentColor" stroke="none" />
      <path d="M8 11.5H12" />
    </svg>
  );
}
