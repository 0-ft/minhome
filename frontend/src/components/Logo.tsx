/** The lit-house mark, same artwork as the favicon. Colours via currentColor. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="9.25 9.25 45.5 45.5" aria-hidden className={className}>
      <path
        d="M12 28 32 12l20 16v22a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z"
        fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="32" cy="36" r="7" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <h1 className={`inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight text-grey-900 ${className}`}>
      <LogoMark className="h-6 w-6 text-blood-300" />
      minhome
    </h1>
  );
}
