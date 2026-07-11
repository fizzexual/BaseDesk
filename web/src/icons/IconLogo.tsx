export function IconLogo(props: { size?: number; className?: string }) {
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
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        d="M7 2H13A5 5 0 0 1 18 7V13A5 5 0 0 1 13 18H7A5 5 0 0 1 2 13V7A5 5 0 0 1 7 2Z M7 6.9A0.9 0.9 0 0 1 8.8 6.9L8.8 9.95A2.6 2.6 0 1 1 8.8 14.05L8.8 14.5L7 14.5Z M10.4 10.9A1.1 1.1 0 1 1 10.4 13.1A1.1 1.1 0 1 1 10.4 10.9Z"
      />
    </svg>
  );
}
