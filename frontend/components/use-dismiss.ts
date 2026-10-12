"use client";

import { useEffect, type RefObject } from "react";

// Calls onClose when the user clicks/taps outside `ref` or presses Escape while `open` is true.
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      // Floating layers rendered on <body> (e.g. a date picker's calendar) belong to whatever opened them.
      if ((e.target as Element | null)?.closest?.("[data-floating]")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}
