export function IconMegaphone(props: { size?: number; className?: string }) {
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
      <path d="M4 8.5 11.5 5.5v9L4 11.5z" />
      <path d="M4 8.5H3a1.5 1.5 0 0 0 0 3h1" />
      <path d="M6.5 11.9v2.6a1.2 1.2 0 0 0 2.4 0v-1.7" />
      <path d="M14 8a3 3 0 0 1 0 4" />
    </svg>
  );
}
