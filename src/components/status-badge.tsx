import { Badge } from "@/components/ui/badge";

const STATUS_MAP: Record<string, { label: string; variant: any }> = {
  queued: { label: "queued", variant: "muted" },
  running: { label: "running", variant: "primary" },
  paused: { label: "paused", variant: "warning" },
  completed: { label: "completed", variant: "success" },
  completed_with_limit: { label: "limit hit", variant: "warning" },
  failed: { label: "failed", variant: "danger" },
  cancelled: { label: "cancelled", variant: "muted" },
  blocked: { label: "blocked", variant: "danger" },
};

export function StatusBadge({ status }: { status: string }) {
  const info = STATUS_MAP[status] ?? { label: status, variant: "outline" };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}
