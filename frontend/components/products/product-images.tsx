"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/api";
import type { Product, ProductImage } from "@/lib/types";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon, TrashIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert, Spinner } from "../ui/feedback";

const MAX_IMAGES = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

// Part panel → Images: the part's photos as thumbnails (a click opens the large view). With Products edit permission:
// Add images (several at once; JPG, PNG, WebP or GIF up to 5 MB, at most 10 per part) and remove one.
export function ProductImages({ product, canEdit, onSaved }: { product: Product; canEdit: boolean; onSaved: () => void }) {
  const notify = useToast();
  const input = useRef<HTMLInputElement>(null);
  const images = product.images ?? [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ProductImage | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (input.current) input.current.value = "";
    if (list.length === 0) return;
    const big = list.find((f) => f.size > MAX_BYTES);
    if (big) return setError(`${big.name} is larger than 5 MB.`);
    if (images.length + list.length > MAX_IMAGES) return setError(`A part can have at most ${MAX_IMAGES} images (it has ${images.length}).`);
    setUploading(true);
    setError(null);
    const form = new FormData();
    list.forEach((f) => form.append("files[]", f));
    try {
      await api.post(`/api/products/${product.id}/images`, form);
      notify(`${list.length} image${list.length === 1 ? "" : "s"} added to ${product.part_number}.`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload the images.");
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.delete(`/api/products/${product.id}/images/${removing.id}`);
      notify("Image removed.");
      setRemoving(null);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the image.");
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Images <span className="ml-1 tabular font-normal text-ink-faint">{images.length}</span>
        </h3>
        {canEdit && (
          <>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
            <Button size="sm" onClick={() => input.current?.click()} disabled={uploading || images.length >= MAX_IMAGES}>
              {uploading ? <Spinner /> : <PlusIcon size={14} />}{uploading ? "Uploading…" : "Add images"}
            </Button>
          </>
        )}
      </header>
      {error && <div className="px-5 pt-3"><Alert>{error}</Alert></div>}
      {images.length === 0 ? (
        <p className="px-5 py-5 text-sm text-ink-muted">
          No images yet.{canEdit && " Add photos of the part: JPG, PNG, WebP or GIF, up to 5 MB each."}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4">
          {images.map((image, i) => (
            <li key={image.id} className="group relative aspect-square overflow-hidden rounded-md border border-line bg-neutral-50">
              <button type="button" onClick={() => setViewing(i)} className="block h-full w-full" title={image.filename}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the API behind the session, not a static asset */}
                <img src={image.url} alt={image.filename} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
              </button>
              {canEdit && (
                <button type="button" onClick={() => setRemoving(image)} aria-label={`Remove ${image.filename}`} title="Remove image"
                        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-ink-muted opacity-0 shadow-sm transition-opacity hover:text-dec focus:opacity-100 group-hover:opacity-100">
                  <TrashIcon size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {viewing !== null && images[viewing] && (
        <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
      {removing && (
        <ConfirmDialog title="Remove this image?" confirmLabel="Remove" busyLabel="Removing…" busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)}>
          {removing.filename} is removed from {product.part_number}.
        </ConfirmDialog>
      )}
    </section>
  );
}

// One image large, over the app, with previous / next; closes on ✕, Escape or a click outside.
function ImageViewer({ images, index, onIndex, onClose }: { images: ProductImage[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const image = images[index]!;
  const step = (d: number) => onIndex((index + d + images.length) % images.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") onIndex((index + 1) % images.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, images.length, onIndex, onClose]);

  return createPortal(
    <div data-floating className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-950/80 p-4 animate-fade-in"
         onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white">
        <CloseIcon size={22} />
      </button>
      {images.length > 1 && (
        <button type="button" onClick={() => step(-1)} aria-label="Previous image" className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
          <ChevronLeftIcon size={22} />
        </button>
      )}
      <figure className="flex max-h-full max-w-5xl flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API behind the session */}
        <img src={image.url} alt={image.filename} className="max-h-[80vh] max-w-full rounded-md object-contain shadow-2xl" />
        <figcaption className="text-sm text-white/80">{image.filename} · {index + 1} of {images.length}</figcaption>
      </figure>
      {images.length > 1 && (
        <button type="button" onClick={() => step(1)} aria-label="Next image" className="absolute right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
          <ChevronRightIcon size={22} />
        </button>
      )}
    </div>,
    document.body,
  );
}
