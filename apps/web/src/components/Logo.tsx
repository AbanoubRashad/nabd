/** Nabd pulse mark: a heartbeat trace inside a rounded square. */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true">
      <rect width="36" height="36" rx="10" fill="var(--ground)" />
      <path
        d="M6 19 H12 L15 11 L19 26 L22 16 L24 19 H30"
        fill="none"
        stroke="var(--signal)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
