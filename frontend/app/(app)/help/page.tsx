"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoxIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DashboardIcon, DownloadIcon, FileIcon, HelpIcon, PlayIcon,
  SearchIcon, TableIcon, TruckIcon, UploadIcon } from "@/components/icons";
import { TINTS, type Tint } from "@/components/ui/tint";
import { useApi } from "@/components/use-api";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import type { HelpResponse, HelpSection, HelpStep, HelpTopic } from "@/lib/types";

// Help: how to use each part of the app, one topic at a time (the topics the user's permissions allow). Each topic has
// its steps, the messages the app can show, a PDF of the same text and a short video.
// ?topic=<key> opens a topic (the "?" links on other pages).
export default function HelpPage() {
  return (
    <Suspense fallback={<HelpSkeleton />}>
      <Help />
    </Suspense>
  );
}

function HelpSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
    </div>
  );
}

// Each category's icon and colour, as the categories of Admin Settings.
const CATEGORY_STYLE: Record<string, { icon: typeof BoxIcon; tint: Tint; left: string; soft: string; text: string }> = {
  Dashboard: { icon: DashboardIcon, tint: "violet", left: "border-l-tint-violet-ink", soft: "bg-tint-violet", text: "text-tint-violet-ink" },
  "John Deere orders": { icon: UploadIcon, tint: "aqua", left: "border-l-tint-aqua-ink", soft: "bg-tint-aqua", text: "text-tint-aqua-ink" },
  Orders: { icon: TableIcon, tint: "amber", left: "border-l-tint-amber-ink", soft: "bg-tint-amber", text: "text-tint-amber-ink" },
  "Shipping and invoices": { icon: TruckIcon, tint: "dec", left: "border-l-dec", soft: "bg-dec-bg", text: "text-dec" },
  Purchasing: { icon: FileIcon, tint: "violet", left: "border-l-tint-violet-ink", soft: "bg-tint-violet", text: "text-tint-violet-ink" },
  "Products and vendors": { icon: BoxIcon, tint: "aqua", left: "border-l-tint-aqua-ink", soft: "bg-tint-aqua", text: "text-tint-aqua-ink" },
};
const styleOf = (category: string) => CATEGORY_STYLE[category] ?? CATEGORY_STYLE.Orders!;

function Help() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, error, loading } = useApi<HelpResponse>("/api/help");
  const [search, setSearch] = useState("");
  const topics = useMemo(() => data?.data ?? [], [data]);
  const found = useMemo(() => filterTopics(topics, search), [topics, search]);
  const wanted = params.get("topic");
  const current = topics.find((t) => t.key === wanted) ?? found[0] ?? null;
  const open = (key: string) => router.replace(`/help?topic=${encodeURIComponent(key)}`, { scroll: false });

  return (
    <div className="-mx-4 -my-5 flex min-h-screen flex-col bg-gradient-to-br from-tint-violet/50 via-neutral-50 to-tint-aqua/40 sm:-mx-6">
      <HelpTopBar search={search} onSearch={setSearch} />
      {error && !data ? (
        <div className="p-6"><Alert title="Could not load Help">{error.message}</Alert></div>
      ) : loading && !data ? (
        <div className="p-6"><HelpSkeleton /></div>
      ) : (
        <div className="flex flex-1 flex-col md:flex-row">
          <aside className="border-b border-line bg-white/60 px-3 py-4 backdrop-blur md:w-72 md:shrink-0 md:border-b-0 md:border-r">
            <TopicNav topics={found} current={current} searching={search.trim() !== ""} onOpen={open} />
            {found.length === 0 && <p className="px-3 py-6 text-sm text-ink-muted">No guide matches &ldquo;{search}&rdquo;.</p>}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col md:p-6">
            <div className="flex-1 overflow-hidden bg-white md:rounded-xl md:border md:border-line md:shadow-card">
              {current
                ? <TopicView key={current.key} topic={current} />
                : <EmptyState title="No Help guides" description="Your account has no pages yet: ask an admin for access." />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Top bar, as the one of a settings page: a back button to the app, the title and the search over every guide ("/"
// focuses it). Help opens as its own window, without the app menu (AppShell).
function HelpTopBar({ search, onSearch }: { search: string; onSearch: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex flex-col gap-3 border-b border-line bg-gradient-to-r from-tint-violet via-white to-tint-aqua/60 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
      <div className="flex shrink-0 items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm"><HelpIcon size={18} /></span>
        <Link href="/" aria-label="Back to the app" title="Back to the app"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white text-ink-muted hover:bg-neutral-50 hover:text-ink">
          <ChevronLeftIcon size={16} />
        </Link>
        <div className="min-w-0 shrink-0">
          <p className="whitespace-nowrap text-lg font-semibold leading-tight text-ink">Help</p>
          <p className="truncate text-xs text-ink-muted">Step-by-step guides</p>
        </div>
      </div>
      <div className="relative min-w-0 sm:mx-auto sm:w-full sm:max-w-md">
        <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input ref={input} type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search guides ( / )" aria-label="Search guides"
               className="h-10 w-full rounded-lg border border-line bg-neutral-50 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-tint-violet-ink/60 focus:bg-white focus:outline-none focus:ring-4 focus:ring-tint-violet-ink/10" />
      </div>
      <div className="hidden w-48 xl:block" />
    </div>
  );
}

// The topics whose text has every word of the search (title, summary, sections, messages).
function filterTopics(topics: HelpTopic[], search: string) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return topics;
  return topics.filter((t) => {
    const text = [t.title, t.category, t.summary ?? "", JSON.stringify(t.sections ?? []), JSON.stringify(t.messages ?? [])].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// Left list, as the one of Admin Settings: each category opens and closes (the current one starts open; all are open
// while searching), with its guides; the current guide is highlighted.
function TopicNav({ topics, current, searching, onOpen }: { topics: HelpTopic[]; current: HelpTopic | null; searching: boolean; onOpen: (key: string) => void }) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set(current ? [current.category] : []));
  const categories = [...new Set(topics.map((t) => t.category))];
  const isOpen = (c: string) => searching || opened.has(c) || current?.category === c;
  const toggle = (c: string) => setOpened((o) => { const n = new Set(o); if (isOpen(c)) n.delete(c); else n.add(c); return n; });
  return (
    <nav aria-label="Help guides" className="space-y-0.5">
      <p className="px-3 pb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Guides</p>
      {categories.map((category) => {
        const style = styleOf(category);
        const Icon = style.icon;
        return (
          <div key={category}>
            <button type="button" onClick={() => toggle(category)} aria-expanded={isOpen(category)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-white/80 ${current?.category === category ? "text-ink" : "text-ink-muted"}`}>
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${TINTS[style.tint].chip}`}><Icon size={13} /></span>
              <span className="flex-1">{category}</span>
              <ChevronDownIcon size={14} className={`shrink-0 text-ink-faint transition-transform ${isOpen(category) ? "" : "-rotate-90"}`} />
            </button>
            {isOpen(category) && (
              <div className="mb-1 ml-5 space-y-0.5 border-l border-line pl-3">
                {topics.filter((t) => t.category === category).map((t) => (
                  <button key={t.key} type="button" onClick={() => onOpen(t.key)} aria-current={t.key === current?.key ? "page" : undefined}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border-l-[3px] px-3 py-2 text-left text-sm transition-colors ${t.key === current?.key
                            ? `${style.left} ${style.soft} font-semibold ${style.text}` : "border-transparent text-ink-muted hover:bg-white hover:text-ink"}`}>
                    <span>{t.title}</span>
                    {t.video && <PlayIcon size={13} className="shrink-0 opacity-60" aria-label="Has a video" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function TopicView({ topic }: { topic: HelpTopic }) {
  const pdf = `/api/help/${encodeURIComponent(topic.key)}/pdf`;
  // Every numbered step of the guide, in order (shown one at a time), and the rest of each section below them.
  const steps = (topic.sections ?? []).flatMap((s) => (s.steps ?? []).map((step) => ({ ...asStep(step), section: s.heading })));
  const others = (topic.sections ?? []).map((s) => ({ ...s, steps: undefined })).filter((s) => s.text || s.bullets || s.table);
  return (
    <article className="overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">{topic.category}</p>
          <h2 className="mt-0.5 text-xl font-semibold text-ink">{topic.title}</h2>
          {topic.summary && <p className="mt-1 text-base text-ink-muted"><Rich text={topic.summary} /></p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={pdf} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            <FileIcon size={15} /> Open PDF
          </a>
          <a href={`${pdf}?download=1`} className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            <DownloadIcon size={15} /> Download PDF
          </a>
        </div>
      </header>
      <div className="space-y-7 px-6 py-6">
        <VideoBlock topic={topic} />
        {steps.length > 0 && <Walkthrough steps={steps} />}
        {others.map((s, i) => <SectionView key={i} section={s} />)}
        {topic.messages && topic.messages.length > 0 && (
          <section>
            <h3 className="text-lg font-semibold text-ink">Messages you may see</h3>
            <dl className="mt-3 divide-y divide-neutral-100 rounded-md border border-line">
              {topic.messages.map((m, i) => (
                <div key={i} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                  <dt className="text-sm font-medium text-ink">&ldquo;{m.message}&rdquo;</dt>
                  <dd className="text-sm text-ink-muted"><Rich text={m.meaning} /></dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </article>
  );
}

function SectionView({ section }: { section: HelpSection }) {
  return (
    <section>
      {section.heading && <h3 className="text-lg font-semibold text-ink">{section.heading}</h3>}
      {section.text && <p className="mt-2 text-base leading-relaxed text-ink"><Rich text={section.text} /></p>}
      {section.steps && (
        <ol className="mt-3 space-y-2">
          {section.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-base text-ink">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">{i + 1}</span>
              <span className="leading-relaxed"><Rich text={asStep(step).text} /></span>
            </li>
          ))}
        </ol>
      )}
      {section.bullets && (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-base leading-relaxed text-ink marker:text-ink-faint">
          {section.bullets.map((b, i) => <li key={i}><Rich text={b} /></li>)}
        </ul>
      )}
      {section.table && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-2xs uppercase tracking-wider text-ink-muted">
              <tr>{section.table.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {section.table.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className={`px-3 py-2 align-top ${j === 0 ? "font-medium text-ink" : "text-ink-muted"}`}><Rich text={cell} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Step = { text: string; image?: string; page?: string; section?: string };
const asStep = (step: HelpStep) => (typeof step === "string" ? { text: step } : step);
const imageUrl = (name: string) => `/api/help/images/${encodeURIComponent(name)}`;

// The guide's steps one at a time: a progress bar, the step with its screenshot (the place to click is marked; click
// the picture to enlarge it), Back / Next (or the arrow keys), dots to jump, and a button to the page it happens on.
// "Show all steps" lists them together.
function Walkthrough({ steps }: { steps: Step[] }) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [all, setAll] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const next = () => (last ? setDone(true) : setIndex((i) => i + 1));
  const back = () => { setDone(false); setIndex((i) => Math.max(0, i - 1)); };

  useEffect(() => {
    if (all || zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" && !done) {
        e.preventDefault();
        if (last) setDone(true);
        else setIndex((i) => i + 1);
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); setDone(false); setIndex((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [all, zoom, done, last]);

  return (
    <section className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">{all ? `All ${steps.length} steps` : done ? "All done" : `Step ${index + 1} of ${steps.length}`}</p>
        <button type="button" onClick={() => setAll((a) => !a)} className="text-sm font-medium text-accent hover:underline">
          {all ? "Show one step at a time" : "Show all steps"}
        </button>
      </div>

      {all ? (
        <ol className="divide-y divide-neutral-100">
          {steps.map((s, i) => (
            <li key={i} className="flex flex-col gap-3 px-4 py-4 sm:flex-row">
              <div className="flex flex-1 gap-3">
                <StepNumber n={i + 1} />
                <div className="text-base leading-relaxed text-ink">
                  <Rich text={s.text} />
                  {s.page && <GoTo page={s.page} />}
                </div>
              </div>
              {s.image && <Shot name={s.image} onZoom={setZoom} className="sm:w-72" />}
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-4 py-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${done ? 100 : ((index + 1) / steps.length) * 100}%` }} />
          </div>
          {done ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700"><CheckIcon size={24} /></span>
              <p className="mt-3 text-lg font-semibold text-ink">You know how to do it</p>
              <p className="mt-1 text-sm text-ink-muted">Go through it again any time, or download the PDF to keep.</p>
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => { setDone(false); setIndex(0); }}>Start again</Button>
            </div>
          ) : (
            <>
              {step.section && <p className="mt-4 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{step.section}</p>}
              <div className="mt-2 flex gap-3">
                <StepNumber n={index + 1} large />
                <p className="pt-1 text-lg leading-relaxed text-ink"><Rich text={step.text} /></p>
              </div>
              {step.image && <Shot name={step.image} onZoom={setZoom} className="mt-4" />}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5" aria-label="Steps">
                  {steps.map((_, i) => (
                    <button key={i} type="button" onClick={() => { setDone(false); setIndex(i); }} aria-label={`Step ${i + 1}`}
                            className={`h-2.5 rounded-full transition-all ${i === index ? "w-6 bg-accent" : i < index ? "w-2.5 bg-accent/50" : "w-2.5 bg-neutral-300 hover:bg-neutral-400"}`} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {step.page && <GoTo page={step.page} />}
                  <Button size="sm" variant="secondary" disabled={index === 0} onClick={back}><ChevronLeftIcon size={15} /> Back</Button>
                  <Button size="sm" variant="primary" onClick={next}>{last ? <>Finish <CheckIcon size={15} /></> : <>Next <ChevronRightIcon size={15} /></>}</Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {zoom && <Lightbox name={zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function StepNumber({ n, large = false }: { n: number; large?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-white ${large ? "h-8 w-8 text-base" : "h-6 w-6 text-sm"}`}>{n}</span>
  );
}

// A link to the page a step happens on.
function GoTo({ page }: { page: string }) {
  return (
    <Link href={page} className="ml-1 inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-accent hover:underline">
      Go to this page <ChevronRightIcon size={14} />
    </Link>
  );
}

// A step's screenshot; clicking it opens it full size.
function Shot({ name, onZoom, className = "" }: { name: string; onZoom: (name: string) => void; className?: string }) {
  return (
    <button type="button" onClick={() => onZoom(name)} title="Click to enlarge"
            className={`block w-full overflow-hidden rounded-md border border-line bg-neutral-50 shadow-sm transition-shadow hover:shadow-md ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, signed-in users only */}
      <img src={imageUrl(name)} alt="Screenshot of this step" loading="lazy" className="block w-full" />
    </button>
  );
}

function Lightbox({ name, onClose }: { name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Screenshot" onClick={onClose}
         className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-10">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-ink hover:bg-white"><CloseIcon size={18} /></button>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, signed-in users only */}
      <img src={imageUrl(name)} alt="Screenshot of this step" className="max-h-full max-w-full rounded-md shadow-2xl" />
    </div>
  );
}

// Text with **bold** words.
function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b> : part);
  return <>{parts}</>;
}

// The guide's video (shipped with the app), when it has one.
function VideoBlock({ topic }: { topic: HelpTopic }) {
  if (!topic.video) return null;
  return (
    <video key={topic.video.url} controls preload="metadata" className="aspect-video w-full rounded-md border border-line bg-black" src={topic.video.url}>
      Your browser cannot play this video.
    </video>
  );
}
