"use client";

import { useParams, useRouter } from "next/navigation";
import type { UploadDetail } from "@/lib/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useApi } from "@/components/use-api";
import { useUploadPolling } from "@/components/use-upload-polling";
import { UploadResult } from "@/components/upload-result";
import { UploadStatusBadge } from "@/components/upload-status";
import { ChevronLeftIcon, DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { DetectionSkeleton, Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/panel";

export default function UploadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ data: UploadDetail }>(`/api/uploads/${encodeURIComponent(id)}`);
  const { upload } = useUploadPolling(data?.data ?? null);

  if (error) {
    return (
      <>
        <PageHeader title="Upload" />
        <Alert title={error.status === 404 ? "Upload not found" : "Could not load the upload"}>{error.message}</Alert>
      </>
    );
  }
  if (loading || !upload) {
    return (
      <div role="status" aria-label="Loading">
        <Skeleton className="mb-3 h-3 w-28" />
        <Skeleton className="mb-2 h-7 w-56" />
        <Skeleton className="mb-6 h-4 w-80 max-w-full" />
        <Skeleton className="mb-6 h-28 w-full rounded-lg" />
        <DetectionSkeleton />
      </div>
    );
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <Button size="sm" onClick={() => (window.history.length > 1 ? router.back() : router.push("/uploads"))} className="pl-2">
          <ChevronLeftIcon size={16} className="text-ink-muted" />
          Back to Upload History
        </Button>
        <a href={`/api/uploads/${upload.id}/download`} download>
          <Button size="sm"><DownloadIcon size={15} className="text-ink-muted" />Download original .xlsx</Button>
        </a>
      </div>
      <PageHeader
        title={`Upload · ${formatDateTime(upload.completed_at ?? upload.uploaded_at)}`}
        description={
          <>
            <span className="inline-flex items-center gap-2"><UploadStatusBadge status={upload.status} /> {upload.original_filename}</span>
            {/* File details (formerly the "File" card) as a compact info bar under the title. */}
            <span className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-neutral-500">
              <span>Size: {formatBytes(upload.byte_size)}</span>
              <span>Uploaded by: {upload.uploaded_by ?? "—"}</span>
              <span title={upload.file_sha256}>SHA-256: {upload.file_sha256.slice(0, 12)}…</span>
            </span>
          </>
        }
      />
      <div className="space-y-6">
        <UploadResult upload={upload} onChanged={reload} />
      </div>
    </>
  );
}
