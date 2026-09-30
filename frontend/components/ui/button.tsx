import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-accent-hover disabled:bg-neutral-300 disabled:shadow-none",
  secondary: "bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 disabled:text-neutral-400",
  ghost: "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:text-neutral-400",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 py-2 text-base";
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 active:scale-[0.98] disabled:active:scale-100 disabled:cursor-not-allowed select-none ${sizing} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
