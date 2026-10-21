// Prints a PDF (same-origin URL or blob URL) without leaving the page: loads it in a hidden frame and opens the
// browser's print dialog for it. The frame is removed a minute later.
export function printPdf(url: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;
  frame.onload = () => {
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 300);
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
