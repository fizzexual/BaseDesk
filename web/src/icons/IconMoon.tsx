export function IconMoon(props: { size?: number; className?: string }) {
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
      <path d="M10 2.5A5.5 5.5 0 0 0 17.5 10A7.5 7.5 0 1 1 10 2.5Z" />
    </svg>
  );
}
