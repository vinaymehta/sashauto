"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "../icons";

// Dates are plain "YYYY-MM-DD" strings (no time zone), like the native date input.
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const parts = (value: string) => value.split("-").map(Number) as [number, number, number];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function label(value: string) {
  const [y, m, d] = parts(value);
  return `${d} ${MONTHS[m - 1]!.slice(0, 3)} ${y}`;
}

// Date field with a calendar dropdown (replaces the browser's date picker). The calendar is rendered on <body>
// (`data-floating`), so it is not clipped by panels or tables and does not close the panel it was opened from.
// `clearable` shows a Clear button; `min` / `max` disable days outside the range.
export function DatePicker({ value, onChange, min, max, id, invalid = false, placeholder = "Select date", clearable = false,
  className = "", "aria-label": ariaLabel }: {
  value: string; onChange: (value: string) => void; min?: string; max?: string; id?: string; invalid?: boolean;
  placeholder?: string; clearable?: boolean; className?: string; "aria-label"?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const initial = parts(value || todayIso());
  const [view, setView] = useState({ year: initial[0], month: initial[1] - 1 });
  // What the calendar shows: days of a month, the months of a year, or a page of 12 years.
  const [mode, setMode] = useState<"days" | "months" | "years">("days");

  function toggle() {
    if (!open) {
      const [y, m] = parts(value || todayIso());
      setView({ year: y, month: m - 1 });
      setMode("days");
    }
    setOpen(!open);
  }

  // Below the field, or above it when there is no room; kept inside the window horizontally.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect();
      const width = 288, height = 340;
      const top = r.bottom + 6 + height > window.innerHeight && r.top - 6 - height > 0 ? r.top - 6 - height : r.bottom + 6;
      setPos({ top, left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  // Outside click and Escape close only the calendar (Escape does not reach the panel underneath).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popover.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  function pick(day: string) {
    onChange(day);
    setOpen(false);
    trigger.current?.focus();
  }

  // ‹ › move one month, one year or 12 years, depending on the mode.
  const shift = (delta: number) => setView((v) => {
    if (mode === "months") return { ...v, year: v.year + delta };
    if (mode === "years") return { ...v, year: v.year + delta * 12 };
    const m = v.month + delta;
    return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
  });
  const firstYear = view.year - (((view.year % 12) + 12) % 12);
  // A month / year can be picked when part of it is inside min..max.
  const monthOff = (y: number, m: number) => (!!min && iso(y, m, 31) < min) || (!!max && iso(y, m, 1) > max);
  const yearOff = (y: number) => (!!min && `${y}-12-31` < min) || (!!max && `${y}-01-01` > max);
  const title = mode === "days" ? `${MONTHS[view.month]} ${view.year}` : mode === "months" ? String(view.year) : `${firstYear} – ${firstYear + 11}`;
  const cell = (active: boolean) => `flex h-11 items-center justify-center rounded-md text-sm transition-colors disabled:cursor-not-allowed disabled:text-neutral-300 ${
    active ? "bg-accent font-semibold text-white" : "text-ink hover:bg-subtle"}`;

  // 6 weeks starting on Monday, with the neighbouring months' days greyed out.
  const first = new Date(view.year, view.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(view.year, view.month, i - offset + 1);
    return { iso: iso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === view.month };
  });
  const today = todayIso();
  const disabled = (day: string) => (!!min && day < min) || (!!max && day > max);

  return (
    <>
      <button ref={trigger} id={id} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}
              className={`flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-left text-base transition-[border-color,box-shadow] duration-150 focus:outline-none ${
                invalid ? "border-neutral-900" : open ? "border-tint-violet-ink/60 ring-4 ring-tint-violet-ink/10" : "border-neutral-300 hover:border-neutral-400 focus:border-tint-violet-ink/60 focus:ring-4 focus:ring-tint-violet-ink/10"
              } ${className}`}>
        <CalendarIcon size={16} className="shrink-0 text-ink-muted" />
        <span className={`tabular min-w-0 flex-1 truncate ${value ? "text-ink" : "text-ink-faint"}`}>{value ? label(value) : placeholder}</span>
        {clearable && value && (
          <span role="button" tabIndex={-1} aria-label="Clear date" onClick={(e) => { e.stopPropagation(); onChange(""); }}
                className="-mr-1 rounded p-0.5 text-ink-faint hover:bg-subtle hover:text-ink">
            <CloseIcon size={14} />
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div ref={popover} data-floating role="dialog" aria-label="Choose date" style={{ top: pos.top, left: pos.left }}
             className="fixed z-[70] w-72 animate-pop-in rounded-xl border border-line bg-white p-3 shadow-pop">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} aria-label={mode === "days" ? "Previous month" : mode === "months" ? "Previous year" : "Previous years"}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink">
              <ChevronLeftIcon size={16} />
            </button>
            <button type="button" onClick={() => setMode(mode === "days" ? "months" : mode === "months" ? "years" : "days")}
                    title={mode === "days" ? "Choose month and year" : mode === "months" ? "Choose year" : "Back to days"}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-ink hover:bg-subtle">
              {title}
              <ChevronDownIcon size={14} className={`text-ink-muted transition-transform ${mode === "days" ? "" : "rotate-180"}`} />
            </button>
            <button type="button" onClick={() => shift(1)} aria-label={mode === "days" ? "Next month" : mode === "months" ? "Next year" : "Next years"}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink">
              <ChevronRightIcon size={16} />
            </button>
          </div>
          {mode === "months" && (
            <div className="grid grid-cols-3 gap-1 py-1">
              {MONTHS.map((name, m) => (
                <button key={name} type="button" disabled={monthOff(view.year, m)} onClick={() => { setView((v) => ({ ...v, month: m })); setMode("days"); }}
                        className={cell(m === view.month)}>
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          )}
          {mode === "years" && (
            <div className="grid grid-cols-3 gap-1 py-1">
              {Array.from({ length: 12 }, (_, i) => firstYear + i).map((y) => (
                <button key={y} type="button" disabled={yearOff(y)} onClick={() => { setView((v) => ({ ...v, year: y })); setMode("months"); }}
                        className={`tabular ${cell(y === view.year)}`}>
                  {y}
                </button>
              ))}
            </div>
          )}
          {mode === "days" && (<>
          <div className="grid grid-cols-7 text-center text-2xs font-medium uppercase tracking-wider text-ink-faint">
            {WEEKDAYS.map((d) => <span key={d} className="py-1.5">{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const selected = d.iso === value;
              const isToday = d.iso === today;
              const off = disabled(d.iso);
              return (
                <button key={d.iso} type="button" disabled={off} onClick={() => pick(d.iso)} aria-pressed={selected}
                        aria-label={label(d.iso)}
                        className={`tabular flex h-9 items-center justify-center rounded-md text-sm transition-colors disabled:cursor-not-allowed disabled:text-neutral-300 ${
                          selected ? "bg-accent font-semibold text-white"
                            : isToday ? "font-semibold text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent/10"
                            : d.inMonth ? "text-ink hover:bg-subtle" : "text-ink-faint hover:bg-subtle"}`}>
                  {d.day}
                </button>
              );
            })}
          </div>
          </>)}
          <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2">
            <button type="button" disabled={disabled(today)} onClick={() => pick(today)}
                    className="rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-accent/10 disabled:text-neutral-300">
              Today
            </button>
            {clearable && value && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }}
                      className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-subtle hover:text-ink">
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
