// Soft accent tints for stat tiles: a light wash fading to white plus a tinted icon chip.
export type Tint = "neutral" | "direction" | "inc" | "dec" | "violet" | "aqua" | "amber";

export const TINTS: Record<Tint, { chip: string; wash: string }> = {
  neutral: { chip: "bg-neutral-900 text-white", wash: "from-neutral-100/80" },
  direction: { chip: "bg-inc-bg text-inc", wash: "from-inc-bg" },
  inc: { chip: "bg-inc-bg text-inc", wash: "from-inc-bg" },
  dec: { chip: "bg-dec-bg text-dec", wash: "from-dec-bg" },
  violet: { chip: "bg-tint-violet text-tint-violet-ink", wash: "from-tint-violet" },
  aqua: { chip: "bg-tint-aqua text-tint-aqua-ink", wash: "from-tint-aqua" },
  amber: { chip: "bg-tint-amber text-tint-amber-ink", wash: "from-tint-amber" },
};
