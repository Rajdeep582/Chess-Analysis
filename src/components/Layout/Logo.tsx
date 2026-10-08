export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
      <path d="M10 8.5h3v2.2h2.2V8.5h1.6v2.2H19V8.5h3v5l-2.4 2v6.3l2.4 2.2v1.5H10V24l2.4-2.2v-6.3l-2.4-2z" fill="var(--accent-ink)" />
      <circle cx="16" cy="18.2" r="1.7" fill="var(--accent)" />
    </svg>
  );
}
