"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Dashboard, UploadDetail } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { UploadCard } from "@/components/upload-card";
import { UploadResult } from "@/components/upload-result";
import { DownloadIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { DetectionSkeleton } from "@/components/ui/skeleton";
import { PageHeader, Panel } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";

export default function UploadAndDetectPage() {
  const { data, error, loading, reload } = useApi<Dashboard>("/api/dashboard");
  const latest = data?.latest_upload;
  const [showUpload, setShowUpload] = useState(false);

  const onFinished = useCallback((upload: UploadDetail) => {
    if (upload.status === "completed") {
      reload();
      setShowUpload(false);
    }
  }, [reload]);

  return (
    <>
      <PageHeader
        title="Upload / Detection"
        description={
          latest
            ? "Quantity changes in the latest upload, compared with the previous upload."
            : "Upload the Supplier Requirements export to detect quantity changes."
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 bg-neutral-900 text-white hover:bg-neutral-800 text-sm font-medium px-4 py-2 rounded-lg transition-all duration-200"
            >
              <UploadIcon size={15} />
              Upload new file
            </button>
            {latest && (
              <a href={`/api/uploads/${latest.id}/download`} download>
                <Button><DownloadIcon size={15} className="text-ink-muted" />Download latest .xlsx</Button>
              </a>
            )}
          </div>
        }
      />

      {/* Right-side Sheet panel for uploading */}
      <Sheet
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload new file"
        description="Drop or choose a Supplier Requirements .xlsx export to compare quantities."
        icon={<UploadIcon size={18} />}
      >
        <UploadCard onFinished={onFinished} />
      </Sheet>

      {data && data.open_product_conflicts > 0 && (
        <div className="mb-5">
          <Alert tone="warning">
            {data.open_product_conflicts} Commodity Type conflict{data.open_product_conflicts === 1 ? " needs" : "s need"} review.{" "}
            <Link href="/products?conflicts=open" className="font-medium underline">Review products</Link>
          </Alert>
        </div>
      )}

      {error ? (
        <Alert title="Could not load the dashboard">{error.message}</Alert>
      ) : loading && !data ? (
        <DetectionSkeleton />
      ) : !latest ? (
        <Panel>
          <EmptyState title="No uploads yet"
                      description="The first upload is stored as the starting point. Quantity changes are detected from the second upload onward." />
        </Panel>
      ) : (
        <UploadResult upload={latest} onChanged={reload} />
      )}
    </>
  );
}
