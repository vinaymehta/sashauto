"use client";

import { useEffect, useRef, type RefObject } from "react";

// Layers open right now, oldest first: only the top one reacts to Escape, so a panel opened over another (e.g. an
// order opened from a Dashboard list) closes alone and the one below stays.
const layers: RefObject<HTMLElement | null>[] = [];

// Calls onClose when the user clicks/taps outside `ref` or presses Escape while `open` is true.
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  // The latest onClose, so a new function each render does not move this layer to the top of the stack.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    layers.push(ref);
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // Floating layers rendered on <body> (e.g. a date picker's calendar) belong to whatever opened them.
      if (target?.closest?.("[data-floating]")) return;
      // A click in a layer opened over this one (another panel or dialog) is not outside: that layer handles it.
      if (layers.slice(layers.indexOf(ref) + 1).some((layer) => layer.current?.contains(target))) return;
      if (ref.current && !ref.current.contains(target)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && layers[layers.length - 1] === ref) close.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      layers.splice(layers.indexOf(ref), 1);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open]);
}
