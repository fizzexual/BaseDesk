export function IconCommand(props: { size?: number; className?: string }) {
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
      <path d="M12 5.5V14.5A2.5 2.5 0 1 0 14.5 12H5.5A2.5 2.5 0 1 0 8 14.5V5.5A2.5 2.5 0 1 0 5.5 8H14.5A2.5 2.5 0 1 0 12 5.5Z" />
    </svg>
  );
}
