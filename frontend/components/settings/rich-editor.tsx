"use client";

import Highlight from "@tiptap/extension-highlight";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ReactNode } from "react";

// A WYSIWYG box for purchase order wording (Admin Settings → Purchase Order): type and format the text as it prints —
// bold, italic, underline, numbered and bulleted lists, a heading, and "Black bar" (white text on black, as on SASH's
// PO). Saved as HTML, which the PDFs print (backend VendorOrders::RichText). `tokens` are placeholders the toolbar
// inserts at the cursor ({company}, {terms_url}); `onReady` gets the starting HTML as the editor writes it (to compare
// changes with).
export function RichEditor({ content, onChange, onReady, tokens = [], readOnly = false, label }: {
  content: string; onChange: (html: string) => void; onReady?: (html: string) => void;
  tokens?: { token: string; title: string }[]; readOnly?: boolean; label: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false }),
      Highlight,
    ],
    content,
    editable: !readOnly,
    immediatelyRender: false,
    onCreate: ({ editor: e }) => onReady?.(e.getHTML()),
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        "aria-label": label,
        class: "min-h-24 px-4 py-3 text-[13px] leading-5 text-ink focus:outline-none " +
               "[&_p]:my-1 [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-bold " +
               "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-0.5 [&_li_p]:my-0 " +
               "[&_mark]:bg-black [&_mark]:px-0.5 [&_mark]:text-white [&_strong]:font-bold",
      },
    },
  });

  return (
    <div className={`overflow-hidden rounded-lg border bg-white ${readOnly ? "border-line" : "border-neutral-300 focus-within:border-accent"}`}>
      {editor && !readOnly && <Toolbar editor={editor} tokens={tokens} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, tokens }: { editor: Editor; tokens: { token: string; title: string }[] }) {
  const state = useEditorState({
    editor,
    // Buttons show as pressed only while the box is being edited (not from a cursor left in a box not in use).
    selector: ({ editor: e }) => {
      const on = (name: string, attrs?: Record<string, unknown>) => e.isFocused && e.isActive(name, attrs);
      return {
        bold: on("bold"), italic: on("italic"), underline: on("underline"), bar: on("highlight"),
        heading: on("heading", { level: 3 }), ordered: on("orderedList"), bullet: on("bulletList"),
        undo: e.can().undo(), redo: e.can().redo(),
      };
    },
  });
  const run = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-neutral-100 bg-neutral-50 px-2 py-1.5">
      <Tool label="Bold (Ctrl+B)" active={state.bold} onClick={() => run().toggleBold().run()}><b>B</b></Tool>
      <Tool label="Italic (Ctrl+I)" active={state.italic} onClick={() => run().toggleItalic().run()}><i className="font-serif">I</i></Tool>
      <Tool label="Underline (Ctrl+U)" active={state.underline} onClick={() => run().toggleUnderline().run()}><u>U</u></Tool>
      <Tool label="Black bar: white text on black" active={state.bar} onClick={() => run().toggleHighlight().run()}>
        <span className="rounded-sm bg-black px-1 text-[11px] font-bold text-white">Bar</span>
      </Tool>
      <Divider />
      <Tool label="Heading" active={state.heading} onClick={() => run().toggleHeading({ level: 3 }).run()}><span className="text-xs font-bold">H</span></Tool>
      <Tool label="Numbered list" active={state.ordered} onClick={() => run().toggleOrderedList().run()}><span className="text-xs">1.</span></Tool>
      <Tool label="Bulleted list" active={state.bullet} onClick={() => run().toggleBulletList().run()}><span className="text-xs">•</span></Tool>
      <Divider />
      <Tool label="Undo (Ctrl+Z)" disabled={!state.undo} onClick={() => run().undo().run()}><span className="text-xs">↶</span></Tool>
      <Tool label="Redo (Ctrl+Shift+Z)" disabled={!state.redo} onClick={() => run().redo().run()}><span className="text-xs">↷</span></Tool>
      {tokens.length > 0 && (
        <span className="ml-auto flex flex-wrap items-center gap-1 text-xs text-ink-muted">
          Insert:
          {tokens.map(({ token, title }) => (
            <button key={token} type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => run().insertContent(token).run()}
                    className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink hover:border-accent hover:text-accent">
              {token}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function Tool({ label, active = false, disabled = false, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
            onMouseDown={(e) => e.preventDefault()} onClick={onClick}
            className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors disabled:opacity-30 ${
              active ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-neutral-200/70 hover:text-ink"}`}>
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden />;

// Wording saved before the editor (plain text, one line each) as the editor's HTML: `list` = a numbered list ("* " = a
// black bar), otherwise paragraphs ("* " = bold). HTML is returned as it is.
export function toEditorHtml(text: string, list: boolean) {
  const value = text.trim();
  if (value.startsWith("<")) return value;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = value.replace(/\\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (list) {
    return `<ol>${lines.map((l) => (l.startsWith("* ") ? `<li><p><mark><strong>${esc(l.slice(2))}</strong></mark></p></li>` : `<li><p>${esc(l)}</p></li>`)).join("")}</ol>`;
  }
  return lines.map((l) => (l.startsWith("* ") ? `<p><strong>${esc(l.slice(2))}</strong></p>` : `<p>${esc(l)}</p>`)).join("");
}
