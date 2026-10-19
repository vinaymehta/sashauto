"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "./button";

// Copies text to the clipboard; falls back to a hidden textarea where the Clipboard API is not available (plain
// http). Returns whether it worked.
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

// Copy button that shows "Copied" for a moment. `small`: the compact style of the file buttons on a generated PO.
export function CopyButton({ text, label = "Copy", small = false }: { text: string; label?: string; small?: boolean }) {
  const notify = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!(await copyText(text))) {
      notify("Could not copy. Select the text and copy it instead.", "error");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const content = <>{copied ? <CheckIcon size={14} className="text-inc" /> : <CopyIcon size={14} className="text-ink-muted" />}{copied ? "Copied" : label}</>;
  return small ? (
    <button type="button" onClick={copy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium text-ink hover:border-neutral-400 hover:bg-subtle">
      {content}
    </button>
  ) : (
    <Button size="sm" onClick={copy}>{content}</Button>
  );
}
