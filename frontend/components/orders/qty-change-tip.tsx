import type { QtyChange } from "@/lib/types";
import { formatQty } from "@/lib/format";
import { InfoTip } from "@/components/ui/info-tip";

// Red i beside a Qty the system changed: on hover it says what changed and why. `field`: the Qty it sits beside.
export function QtyChangeTip({ change, field }: { change?: QtyChange | null; field: "ordered" | "dispatched" }) {
  if (!change) return null;
  const [was, now] = change[field];
  if (was === now) return null;
  return (
    <InfoTip tone="danger" label="Quantity changed by the system">
      <b>System changed {field === "ordered" ? "Ordered" : "Dispatched"} {formatQty(was)} → {formatQty(now)}</b>
      {change.causes.map((c) => <span key={c} className="mt-1 block">{c}</span>)}
    </InfoTip>
  );
}
