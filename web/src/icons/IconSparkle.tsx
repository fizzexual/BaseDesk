export function IconSparkle(props: { size?: number; className?: string }) {
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
      <path d="M8.5 5.5Q9.25 10.25 14 11Q9.25 11.75 8.5 16.5Q7.75 11.75 3 11Q7.75 10.25 8.5 5.5Z" />
      <path d="M15.5 3V6" />
      <path d="M14 4.5H17" />
    </svg>
  );
}
