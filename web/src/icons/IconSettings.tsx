export function IconSettings(props: { size?: number; className?: string }) {
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
      <path d="M8.31 2.69A7.5 7.5 0 0 1 11.69 2.69L11.97 4.6A5.75 5.75 0 0 1 13.7 5.6L15.49 4.89A7.5 7.5 0 0 1 17.17 7.81L15.66 9A5.75 5.75 0 0 1 15.66 11L17.17 12.19A7.5 7.5 0 0 1 15.49 15.11L13.7 14.4A5.75 5.75 0 0 1 11.97 15.4L11.69 17.31A7.5 7.5 0 0 1 8.31 17.31L8.03 15.4A5.75 5.75 0 0 1 6.3 14.4L4.51 15.11A7.5 7.5 0 0 1 2.83 12.19L4.34 11A5.75 5.75 0 0 1 4.34 9L2.83 7.81A7.5 7.5 0 0 1 4.51 4.89L6.3 5.6A5.75 5.75 0 0 1 8.03 4.6L8.31 2.69Z" />
      <circle cx="10" cy="10" r="2.25" />
    </svg>
  );
}
