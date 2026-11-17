"use client";

import { useState, type ReactNode } from "react";
import type { ProductImage } from "@/lib/types";
import { ImageViewer } from "./product-images";
import { ImageOffIcon } from "../icons";

export interface PartThumbnailProps {
  imageUrl?: string | null;
  images?: ProductImage[] | null;
  alt?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  fallbackIcon?: ReactNode;
  showFallback?: boolean;
}

const SIZES = {
  sm: "h-7 w-7 min-w-7 min-h-7 rounded",
  md: "h-10 w-10 min-w-10 min-h-10 rounded-md",
  lg: "h-14 w-14 min-w-14 min-h-14 rounded-lg",
};

const ICON_SIZES = {
  sm: 13,
  md: 16,
  lg: 20,
};

export function PartThumbnail({
  imageUrl,
  images,
  alt,
  size = "sm",
  className = "",
  fallbackIcon,
  showFallback = true,
}: PartThumbnailProps) {
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  const primaryUrl = imageUrl || images?.[0]?.url;
  const imageList: ProductImage[] =
    images && images.length > 0
      ? images
      : primaryUrl
      ? [{ id: 0, url: primaryUrl, filename: alt || "Part image" }]
      : [];

  if (!primaryUrl) {
    if (fallbackIcon) return <>{fallbackIcon}</>;
    if (showFallback) {
      return (
        <span
          title={alt ? `No image for ${alt}` : "No image available"}
          aria-label={alt ? `No image for ${alt}` : "No image available"}
          className={`flex shrink-0 items-center justify-center rounded border border-neutral-200/80 bg-neutral-100 text-neutral-400 shadow-2xs ${SIZES[size]} ${className}`}
        >
          <ImageOffIcon size={ICON_SIZES[size]} className="opacity-50" />
        </span>
      );
    }
    return null;
  }

  return (
    <>
      {/* A span, not a <button>: the thumbnail sits inside clickable rows and cards that are buttons themselves. */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setViewingIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.stopPropagation();
          e.preventDefault();
          setViewingIndex(0);
        }}
        className={`group relative block shrink-0 cursor-zoom-in overflow-hidden border border-line bg-neutral-100 shadow-xs transition-all hover:ring-2 hover:ring-accent focus:outline-none focus:ring-2 focus:ring-accent ${SIZES[size]} ${className}`}
        title={`View large image: ${alt || "Part"}`}
        aria-label={`View large image of ${alt || "part"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the API behind the session */}
        <img
          src={primaryUrl}
          alt={alt || "Part thumbnail"}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-110"
        />
      </span>

      {viewingIndex !== null && imageList[viewingIndex] && (
        // Clicks in the viewer (a portal) still bubble through React to the row or card around the thumbnail: stop them.
        <span className="contents" onClick={(e) => e.stopPropagation()}>
          <ImageViewer
            images={imageList}
            index={viewingIndex}
            onIndex={setViewingIndex}
            onClose={() => setViewingIndex(null)}
          />
        </span>
      )}
    </>
  );
}
