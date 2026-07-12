export function IconBook(props: { size?: number; className?: string }) {
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
      <path d="M10 5.5C8.7 4.6 7.1 4 5 4c-.9 0-1.6.1-2.2.3a.5.5 0 0 0-.3.5v9.1c0 .3.3.6.7.5.5-.2 1.2-.2 1.8-.2 2.1 0 3.7.6 5 1.5" />
      <path d="M10 5.5C11.3 4.6 12.9 4 15 4c.9 0 1.6.1 2.2.3a.5.5 0 0 1 .3.5v9.1c0 .3-.3.6-.7.5-.5-.2-1.2-.2-1.8-.2-2.1 0-3.7.6-5 1.5" />
      <path d="M10 5.5v11" />
    </svg>
  );
}
