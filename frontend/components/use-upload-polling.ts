"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { UploadDetail } from "@/lib/types";

const POLL_MS = 1500;

// Re-fetches an upload until it reaches a final status (completed or failed).
export function useUploadPolling(initial: UploadDetail | null) {
  const [upload, setUpload] = useState<UploadDetail | null>(initial);
  const [pollError, setPollError] = useState<string | null>(null);
  const [source, setSource] = useState(initial);

  if (initial !== source) {
    setSource(initial);
    setUpload(initial);
  }

  const id = upload?.id;
  const done = !upload || upload.status === "completed" || upload.status === "failed";

  useEffect(() => {
    if (done || id === undefined) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ data: UploadDetail }>(`/api/uploads/${id}`);
        if (active) {
          setUpload(res.data);
          setPollError(null);
        }
      } catch {
        if (active) setPollError("Lost contact with the server while waiting for the result. Retrying…");
        if (active) setUpload((u) => (u ? { ...u } : u)); // schedule another attempt
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, done, upload]);

  return { upload, setUpload, pollError };
}
