"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { UploadDetail } from "@/lib/types";
import { formatBytes, formatCount } from "@/lib/format";
import { AlertIcon, FileIcon, UploadIcon } from "./icons";
import { ACTIVITY_CHANGED_EVENT } from "./notification-bell";
import { useToast } from "./toast";
import { UploadResult } from "./upload-result";
import { useUploadPolling } from "./use-upload-polling";
import { Button } from "./ui/button";
import { Spinner } from "./ui/feedback";

const MAX_BYTES = 20 * 1024 * 1024;

// Client-side checks give immediate feedback only; the server validates everything again.
function checkFile(files: FileList | File[] | null | undefined): { file?: File; error?: string } {
  const list = files ? Array.from(files) : [];
  if (list.length === 0) return {};
  if (list.length > 1) return { error: "Upload one file at a time." };
  const file = list[0]!;
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { error: `“${file.name}” is not an Excel .xlsx file. Export the report as .xlsx (not .xls or .csv) and try again.` };
  }
  if (file.size === 0) return { error: "The file is empty." };
  if (file.size > MAX_BYTES) return { error: `The file is ${formatBytes(file.size)}; the maximum is ${formatBytes(MAX_BYTES)}.` };
  return { file };
}

export function UploadCard({ onFinished }: { onFinished: (upload: UploadDetail) => void }) {
  const notify = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { upload, setUpload, pollError } = useUploadPolling(null);
  const reported = useRef<number | null>(null);

  const processing = upload?.status === "pending" || upload?.status === "processing";
  const busy = submitting || processing;

  // Report each finished upload exactly once.
  useEffect(() => {
    if (!upload || reported.current === upload.id) return;
    if (upload.status !== "completed" && upload.status !== "failed") return;
    reported.current = upload.id;
    window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
    if (upload.status === "completed") {
      const changes = (upload.stats.increase_count ?? 0) + (upload.stats.decrease_count ?? 0);
      notify(upload.previous_version === null
        ? "First upload stored. Changes are detected from the next upload."
        : `Upload processed: ${changes === 0 ? "no quantity changes" : `${changes} quantity change${changes === 1 ? "" : "s"}`}.`);
    } else {
      notify("The upload was rejected. See the problems listed below.", "error");
    }
    onFinished(upload);
  }, [upload, notify, onFinished]);

  function choose(files: FileList | File[] | null | undefined) {
    const result = checkFile(files);
    setError(result.error ?? null);
    if (result.file) {
      setFile(result.file);
      setUpload(null);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await api.post<{ data: UploadDetail }>("/api/uploads", form);
      setUpload(res.data);
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The upload failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!busy) choose(e.dataTransfer.files);
  }

  return (
    <section
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={onDrop}
      className={`overflow-hidden rounded-lg border shadow-card transition-[border-color,background-color,box-shadow] duration-200 ${
        dragging ? "border-dashed border-neutral-900 bg-neutral-50 ring-4 ring-neutral-900/5"
          : `bg-gradient-to-r from-tint-violet via-white to-white ${error ? "border-neutral-900" : "border-tint-violet-ink/15"}`
      }`}
    >
      <input ref={inputRef} type="file" className="sr-only" disabled={busy} tabIndex={-1}
             accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
             onChange={(e) => choose(e.target.files)} />

      <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
          file ? "bg-accent text-white" : "bg-white text-tint-violet-ink ring-1 ring-tint-violet-ink/20"
        }`}>
          {busy ? <Spinner /> : file ? <FileIcon size={18} /> : <UploadIcon size={18} />}
        </span>

        <div className="min-w-0 flex-1">
          {processing ? (
            <>
              <p className="font-medium text-ink">{upload?.status === "pending" ? "Queued for processing…" : "Validating and comparing…"}</p>
              <p className="truncate text-sm text-ink-muted">{upload?.original_filename} · processing continues if you leave this page</p>
            </>
          ) : file ? (
            <>
              <p className="truncate font-medium text-ink">{file.name}</p>
              <p className="text-sm text-ink-muted">{formatBytes(file.size)} · ready to upload</p>
            </>
          ) : dragging ? (
            <>
              <p className="font-medium text-ink">Drop to select this file</p>
              <p className="text-sm text-ink-muted">.xlsx only, up to {formatBytes(MAX_BYTES)}</p>
            </>
          ) : (
            <>
              <p className="font-medium text-ink">Upload a new file</p>
              <p className="text-sm text-ink-muted">
                Supplier Requirements export (.xlsx, up to {formatBytes(MAX_BYTES)}). Drag it here or choose a file.
              </p>
            </>
          )}
        </div>

        {!processing && (
          <div className="flex shrink-0 gap-2">
            {file ? (
              <>
                <Button variant="ghost" onClick={() => setFile(null)} disabled={submitting}>Remove</Button>
                <Button variant="primary" onClick={submit} disabled={submitting}>
                  {submitting && <Spinner className="border-white/40 border-t-white" />}
                  {submitting ? "Uploading…" : "Upload and compare"}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={submitting}>
                <UploadIcon size={15} />
                Choose file
              </Button>
            )}
          </div>
        )}
      </div>

      {(error || pollError || upload?.status === "completed") && (
        <div className="space-y-2 border-t border-line bg-white px-6 py-4">
          {error && <p className="flex animate-fade-in items-start gap-2 text-sm font-medium text-neutral-900"><AlertIcon size={15} className="mt-0.5 shrink-0" />{error}</p>}
          {pollError && <p className="animate-fade-in text-sm text-warn">{pollError}</p>}
          {upload?.status === "completed" && (
            <p className="animate-fade-in text-sm text-ink-muted">
              <span className="font-semibold text-neutral-900">✓ Upload processed</span> · {formatCount(upload.row_count)} rows ·{" "}
              <Link href={`/uploads/${upload.id}`} className="underline underline-offset-2 hover:text-ink">details</Link>
            </p>
          )}
        </div>
      )}
      {upload?.status === "failed" && <div className="border-t border-line bg-white p-6"><UploadResult upload={upload} /></div>}
    </section>
  );
}
