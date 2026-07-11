export function IconSun(props: { size?: number; className?: string }) {
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
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2.5V4.25" />
      <path d="M10 17.5V15.75" />
      <path d="M2.5 10H4.25" />
      <path d="M17.5 10H15.75" />
      <path d="M15.3 4.7L14.07 5.93" />
      <path d="M4.7 4.7L5.93 5.93" />
      <path d="M15.3 15.3L14.07 14.07" />
      <path d="M4.7 15.3L5.93 14.07" />
    </svg>
  );
}
