import type { ReactNode } from "react";

type Tone = "neutral" | "up" | "down" | "warn" | "dark";

// Status tones: green = completed/sent, red = failed, amber = processing/sending, neutral = queued.
const tones: Record<Tone, string> = {
  neutral: "bg-white text-neutral-500 border-neutral-300",
  up: "bg-status-ok-bg text-status-ok border-status-ok/20",
  down: "bg-status-fail-bg text-status-fail border-status-fail/20",
  warn: "bg-status-busy-bg text-status-busy border-status-busy/20",
  dark: "bg-neutral-900 text-white border-neutral-900",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded border px-2.5 py-1 text-xs font-medium leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}
