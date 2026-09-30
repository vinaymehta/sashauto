import type { UploadStatus } from "@/lib/types";
import { Badge } from "./ui/badge";

const LABELS: Record<UploadStatus, [string, "neutral" | "up" | "down" | "warn" | "dark"]> = {
  pending: ["Queued", "neutral"],
  processing: ["Processing", "warn"],
  completed: ["Completed", "up"],
  failed: ["Failed", "down"],
};

export function UploadStatusBadge({ status }: { status: UploadStatus }) {
  const [label, tone] = LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
