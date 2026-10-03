// SASH logo, traced from the brand artwork: a teal mark (a rising wedge on top, the "//" pair of slanted
// bars in the middle, a falling wedge below, separated by thin gaps) and the heavy SASH wordmark.
// `tone="light"` is for the navy bars (white wordmark), `tone="dark"` for light pages.
export function BrandLogo({ tone = "light", size = "md" }: { tone?: "light" | "dark"; size?: "sm" | "md" | "lg" }) {
  // The mark is a little taller than the capital letters, as in the artwork.
  const height = { sm: "h-5", md: "h-6", lg: "h-[2.375rem]" }[size];
  const text = { sm: "text-[1.375rem]", md: "text-[1.625rem]", lg: "text-[2.625rem]" }[size];
  return (
    <span className="inline-flex items-center gap-1.5" aria-label="SASH">
      <svg viewBox="0 0 48 51" className={`${height} w-auto shrink-0`} fill="#0aa1c0" aria-hidden>
        <path d="M0.5 15.5 48 0v15.5z" />
        <path d="M13.5 17.5h16L15.5 34H0.5z" />
        <path d="M31 17.5h16.5L33.5 34H18z" />
        <path d="M0 36h47.5L0 51z" />
      </svg>
      <span className={`${text} font-[family-name:var(--font-brand)] leading-none tracking-[0.01em] ${tone === "light" ? "text-white" : "text-neutral-950"}`}>
        SASH
      </span>
    </span>
  );
}
