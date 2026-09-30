import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const control =
  "h-9 rounded-md border bg-white px-3 text-base text-ink placeholder:text-ink-faint " +
  "transition-[border-color,box-shadow] duration-150 focus:outline-none disabled:bg-subtle disabled:text-ink-faint";
const borders = {
  normal: "border-neutral-300 hover:border-neutral-400 focus:border-tint-violet-ink/60 focus:ring-4 focus:ring-tint-violet-ink/10",
  invalid: "border-neutral-900 focus:border-neutral-900 focus:ring-4 focus:ring-neutral-900/10",
};

export function Input({ className = "", invalid = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`${control} ${invalid ? borders.invalid : borders.normal} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${control} ${borders.normal} pr-8 ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, htmlFor, hint, error, required, optional, children }: {
  label: string; htmlFor: string; hint?: string; error?: string | null; required?: boolean; optional?: boolean; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink">{label}</label>
        {required && <span className="text-2xs font-medium uppercase tracking-wider text-ink-muted">Required</span>}
        {optional && <span className="text-2xs font-medium uppercase tracking-wider text-ink-faint">Optional</span>}
      </div>
      {children}
      {error ? <p id={`${htmlFor}-error`} className="flex items-start gap-1.5 text-sm font-medium text-neutral-900"><span aria-hidden className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-2xs font-bold text-white">!</span>{error}</p>
             : hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
    </div>
  );
}
