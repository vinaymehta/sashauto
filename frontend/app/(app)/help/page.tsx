"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertIcon, BoxIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DashboardIcon, DownloadIcon, FileIcon, HelpIcon,
  PencilIcon, PlayIcon,
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
// The guide menu (left) and "On this page" (right): the same width, each held in place while the guide scrolls.
const SIDE_PANEL = "md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:w-72 md:shrink-0 md:self-start md:overflow-y-auto";

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
        <div className="flex flex-1 flex-col md:flex-row md:items-start">
          <aside className={`border-b border-line bg-white/60 px-3 py-4 backdrop-blur md:border-b-0 md:border-r ${SIDE_PANEL}`}>
            <TopicNav topics={found} current={current} searching={search.trim() !== ""} onOpen={open} />
            {found.length === 0 && <p className="px-3 py-6 text-sm text-ink-muted">No guide matches &ldquo;{search}&rdquo;.</p>}
          </aside>
          {current
            ? <TopicView key={current.key} topic={current} onOpen={open}
                         related={topics.filter((t) => t.category === current.category && t.key !== current.key
                           && t !== topics[topics.indexOf(current) - 1] && t !== topics[topics.indexOf(current) + 1]).slice(0, 4)}
                         previous={topics[topics.indexOf(current) - 1]} next={topics[topics.indexOf(current) + 1]} />
            : <div className="min-w-0 flex-1 self-stretch bg-white"><EmptyState title="No Help guides" description="Your account has no pages yet: ask an admin for access." /></div>}
        </div>
      )}
    </div>
  );
}

// Top bar, fixed at the top and lined up with the columns below: Help (over the guide menu), the search over every
// guide ("/" focuses it) in the middle, and the way back to the app (over "On this page"). Help opens as its own
// window, without the app menu (AppShell).
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
    <header className="z-30 flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-3 md:sticky md:top-0 md:h-16 md:flex-nowrap md:gap-0 md:px-0 md:py-0">
      <div className="flex min-w-0 flex-1 items-center gap-3 md:w-72 md:flex-none md:shrink-0 md:px-5">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm"><HelpIcon size={17} /></span>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-base font-semibold leading-tight text-ink">Help</p>
          <p className="truncate text-xs text-ink-muted">Step-by-step guides</p>
        </div>
      </div>
      <div className="relative order-last w-full md:order-none md:mx-auto md:w-auto md:min-w-0 md:max-w-xl md:flex-1 md:px-6">
        <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint md:left-9" />
        <input ref={input} type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search guides ( / )" aria-label="Search guides"
               className="h-10 w-full rounded-lg border border-line bg-neutral-50 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-tint-violet-ink/60 focus:bg-white focus:outline-none focus:ring-4 focus:ring-tint-violet-ink/10" />
      </div>
      <div className="flex shrink-0 justify-end md:px-5 xl:w-72">
        <Link href="/" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink-muted hover:bg-neutral-50 hover:text-ink">
          <ChevronLeftIcon size={15} /> Back to the app
        </Link>
      </div>
    </header>
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

// Plain text of a guide's **bold** markup (alt text, labels).
const plain = (text: string) => text.replace(/\*\*/g, "");
// A section's anchor: its position and heading (headings can repeat, e.g. a section itself called "Steps").
const anchor = (i: number, text: string) => `s${i}-${plain(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

// One guide, laid out as documentation sites are (guides menu left, the guide in the middle, "On this page" right):
// breadcrumb, title and PDF buttons, then the video, steps and notes (text lines kept short), up to four related
// guides, and Previous / Next guide links. The guide fills the middle with a 10% margin each side; the menu and
// "On this page" are the same width and stay in place while it scrolls.
function TopicView({ topic, related, previous, next, onOpen }: {
  topic: HelpTopic; related: HelpTopic[]; previous?: HelpTopic; next?: HelpTopic; onOpen: (key: string) => void;
}) {
  const pdf = `/api/help/${encodeURIComponent(topic.key)}/pdf`;
  // Every numbered step of the guide, in order (shown one at a time), and the rest of each section below them.
  const steps = (topic.sections ?? []).flatMap((s) => (s.steps ?? []).map((step) => ({ ...asStep(step), section: s.heading })));
  // What a section has besides its steps stays below; for a section of steps, under "Notes" (its own heading, e.g.
  // "Steps", is already the walkthrough's).
  const others = (topic.sections ?? []).map((s) => ({ ...s, heading: s.steps?.length ? "Notes" : s.heading, steps: undefined }))
    .filter((s) => s.text || s.bullets || s.table);
  const hasMessages = (topic.messages?.length ?? 0) > 0;
  const contents = [
    topic.video && { id: "h-video", label: "Video", icon: PlayIcon, tint: "violet" },
    steps.length > 0 && { id: "h-steps", label: `Steps (${steps.length})`, icon: CheckIcon, tint: "aqua" },
    ...others.flatMap((s, i) => (s.heading ? [{ id: anchor(i, s.heading), label: plain(s.heading), icon: s.heading === "Notes" ? PencilIcon : FileIcon, tint: "amber" }] : [])),
    hasMessages && { id: "h-messages", label: "Messages you may see", icon: AlertIcon, tint: "dec" },
    related.length > 0 && { id: "h-related", label: "Related guides", icon: HelpIcon, tint: "violet" },
    (previous || next) && { id: "h-more", label: "Previous and next guide", icon: ChevronRightIcon, tint: "aqua" },
  ].filter(Boolean) as Contents[];
  const go = (key: string) => { onOpen(key); window.scrollTo({ top: 0 }); };
  return (
    <>
    <article className="min-w-0 flex-1 self-stretch bg-white px-5 py-8 md:px-0 lg:py-10">
      {/* A % margin is a share of the article's width (the middle), unlike a % padding (the whole row). */}
      <div className="min-w-0 md:mx-[10%]">
        <header className="border-b border-line pb-6">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            <span>Help</span>
            <ChevronRightIcon size={13} className="text-ink-faint" />
            <span>{topic.category}</span>
          </nav>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem] sm:leading-tight">{topic.title}</h2>
          {topic.summary && <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"><Rich text={topic.summary} /></p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={pdf} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <FileIcon size={15} /> Open PDF
            </a>
            <a href={`${pdf}?download=1`} className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              <DownloadIcon size={15} /> Download PDF
            </a>
          </div>
        </header>
        <div className="mt-8 space-y-10">
          {topic.video && (
            <section id="h-video" className="scroll-mt-20">
              <h3 className="text-lg font-semibold text-ink">Video</h3>
              <p className="mt-1 text-sm text-ink-muted">A short recording of the steps below. The same steps are written out under it.</p>
              <VideoBlock topic={topic} />
            </section>
          )}
          {steps.length > 0 && (
            <section id="h-steps" className="scroll-mt-20">
              <h3 className="text-lg font-semibold text-ink">Steps</h3>
              <Walkthrough steps={steps} />
            </section>
          )}
          {others.map((s, i) => <SectionView key={i} section={s} id={s.heading ? anchor(i, s.heading) : undefined} />)}
          {hasMessages && (
            <section id="h-messages" className="scroll-mt-20">
              <h3 className="text-lg font-semibold text-ink">Messages you may see</h3>
              <p className="mt-1 text-sm text-ink-muted">What the app may show while you do this, and what to do about it.</p>
              <div className="mt-3 overflow-hidden rounded-md border border-line">
                <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 bg-neutral-50 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted sm:grid">
                  <span>Message on the screen</span><span>What it means and what to do</span>
                </div>
                <dl className="divide-y divide-neutral-100">
                  {topic.messages!.map((m, i) => (
                    <div key={i} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                      <dt className="text-[14px] font-medium leading-6 text-ink"><span className="mr-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint sm:hidden">Message:</span>&ldquo;{m.message}&rdquo;</dt>
                      <dd className="text-[14px] leading-6 text-ink-soft"><span className="mr-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint sm:hidden">What to do:</span><Rich text={m.meaning} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          )}
          {related.length > 0 && (
            <section id="h-related" className="scroll-mt-20 border-t border-line pt-6">
              <h3 className="text-lg font-semibold text-ink">Related guides</h3>
              <p className="mt-1 text-sm text-ink-muted">More guides about {topic.category.toLowerCase()}.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {related.map((t) => <li key={t.key}><GuideLink topic={t} onClick={() => go(t.key)} /></li>)}
              </ul>
            </section>
          )}
        </div>
        {(previous || next) && (
          <section id="h-more" className="mt-10 scroll-mt-20 border-t border-line pt-6">
            <h3 className="text-lg font-semibold text-ink">Previous and next guide</h3>
            <p className="mt-1 text-sm text-ink-muted">The guides just before and after this one in the Guides menu, to read them in order.</p>
            <nav aria-label="Previous and next guide" className="mt-3 grid gap-3 sm:grid-cols-2">
              {previous ? <GuideLink topic={previous} onClick={() => go(previous.key)} label="Previous guide" /> : <span className="hidden sm:block" />}
              {next && <GuideLink topic={next} onClick={() => go(next.key)} label="Next guide" />}
            </nav>
          </section>
        )}
      </div>
    </article>
    <OnThisPage topic={topic} contents={contents} />
    </>
  );
}

// A link to another guide: its category's icon, its title and category, and (for previous / next) what it is.
function GuideLink({ topic, onClick, label }: { topic: HelpTopic; onClick: () => void; label?: "Previous guide" | "Next guide" }) {
  const style = styleOf(topic.category);
  const Icon = style.icon;
  const after = label === "Next guide";
  return (
    <button type="button" onClick={onClick} aria-label={`${label ?? "Open guide"}: ${topic.title}`}
            className={`group flex h-full w-full items-center gap-3 rounded-lg border border-line px-3 py-3 hover:border-accent/50 hover:bg-neutral-50 ${after ? "flex-row-reverse text-right" : "text-left"}`}>
      {label ? (after ? <ChevronRightIcon size={16} className="shrink-0 text-ink-faint group-hover:text-accent" /> : <ChevronLeftIcon size={16} className="shrink-0 text-ink-faint group-hover:text-accent" />)
             : <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${TINTS[style.tint].chip}`}><Icon size={15} /></span>}
      <span className="min-w-0 flex-1">
        {label && <span className="block text-2xs font-semibold uppercase tracking-wider text-ink-faint">{label}</span>}
        <span className="block text-sm font-semibold text-ink group-hover:text-accent">{topic.title}</span>
        <span className="block text-xs text-ink-muted">{topic.category}</span>
      </span>
      {!label && <ChevronRightIcon size={14} className="shrink-0 text-ink-faint group-hover:text-accent" />}
    </button>
  );
}

type Contents = { id: string; label: string; icon: typeof BoxIcon; tint: Tint };

// Right panel, styled as the guide menu: the guide's sections (the one being read is highlighted as you scroll), and
// a way back to the top once the page is scrolled down.
function OnThisPage({ topic, contents }: { topic: HelpTopic; contents: Contents[] }) {
  const style = styleOf(topic.category);
  const [active, setActive] = useState(contents[0]?.id);
  // A section picked here stays highlighted while the page scrolls to it (near the bottom it cannot reach the top).
  const picked = useRef(0);
  // "Back to top" only once the page is scrolled down.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 200);
      if (Date.now() - picked.current < 1000) return;
      // The last section whose top has passed a line under the top bar; the last section once at the very bottom.
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = contents[0]?.id;
      for (const c of contents) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top <= 160) current = c.id;
      }
      setActive(atEnd && window.scrollY > 0 ? contents[contents.length - 1]?.id : current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [contents]);
  return (
    <aside className={`hidden border-l border-line bg-white/60 px-3 py-4 backdrop-blur xl:block ${SIDE_PANEL}`}>
      <nav aria-label="On this page" className="space-y-0.5">
        <p className="px-3 pb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">On this page</p>
        {contents.map((c) => {
          const Icon = c.icon;
          const on = c.id === active;
          return (
            <a key={c.id} href={`#${c.id}`} aria-current={on ? "location" : undefined} onClick={() => { picked.current = Date.now(); setActive(c.id); }}
               className={`flex items-center gap-2.5 rounded-md border-l-[3px] px-2 py-2 text-sm transition-colors ${on
                 ? `${style.left} ${style.soft} font-semibold ${style.text}` : "border-transparent text-ink-muted hover:bg-white hover:text-ink"}`}>
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${TINTS[c.tint].chip}`}><Icon size={13} /></span>
              <span className="min-w-0 flex-1">{c.label}</span>
            </a>
          );
        })}
      </nav>
      {scrolled && (
      <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="mx-1 mt-6 flex w-[calc(100%-0.5rem)] items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:bg-white hover:text-ink">
        <ChevronDownIcon size={14} className="rotate-180" /> Back to top
      </button>
      )}
    </aside>
  );
}

// A line under the guides' standard section headings, saying what the section is.
const SECTION_HINTS: Record<string, string> = {
  "What you can do here": "Everything this page lets you do.",
  "Words on this page": "What the words and labels on this page mean.",
  Notes: "Good to know about these steps.",
};

function SectionView({ section, id }: { section: HelpSection; id?: string }) {
  const features = section.heading === "What you can do here";
  const hint = section.heading ? SECTION_HINTS[section.heading] : undefined;
  return (
    <section id={id} className="scroll-mt-20">
      {section.heading && <h3 className="text-lg font-semibold text-ink">{section.heading}</h3>}
      {hint && <p className="mt-0.5 text-sm text-ink-muted">{hint}</p>}
      {section.text && <p className="mt-2 max-w-prose text-[15px] leading-7 text-ink-soft"><Rich text={section.text} /></p>}
      {section.steps && (
        <ol className="mt-3 max-w-prose space-y-2">
          {section.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-[15px] text-ink-soft">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">{i + 1}</span>
              <span className="leading-7"><Rich text={asStep(step).text} /></span>
            </li>
          ))}
        </ol>
      )}
      {section.bullets && (features ? (
        // Each thing the page does on its own row, with a tick: easy to scan.
        <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-line">
          {section.bullets.map((b, i) => (
            <li key={i} className="flex gap-3 px-4 py-2.5 text-[14.5px] leading-6 text-ink-soft">
              <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-inc-bg text-inc"><CheckIcon size={12} /></span>
              <span><Rich text={b} strong="font-medium" /></span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 max-w-prose space-y-2 text-[15px] leading-7 text-ink-soft">
          {section.bullets.map((b, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
              <span><Rich text={b} /></span>
            </li>
          ))}
        </ul>
      ))}
      {section.table && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full table-fixed text-left text-[14px] leading-6">
            <colgroup><col className="w-[34%]" /><col /></colgroup>
            <thead className="bg-neutral-50 text-2xs uppercase tracking-wider text-ink-muted">
              <tr>{section.table.columns.map((c) => <th key={c} className="px-4 py-2 font-semibold">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {section.table.rows.map((row, i) => (
                <tr key={i} className="hover:bg-neutral-50/60">
                  {row.map((cell, j) => <td key={j} className={`px-4 py-2.5 align-top ${j === 0 ? "font-semibold text-ink" : "text-ink-soft"}`}><Rich text={cell} /></td>)}
                </tr>
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
// The last step has no Next: the guide simply ends there. It opens on all the steps listed together.
function Walkthrough({ steps }: { steps: Step[] }) {
  const [index, setIndex] = useState(0);
  // Every step listed at first; "Show one step at a time" walks through them.
  const [all, setAll] = useState(true);
  const [zoom, setZoom] = useState<{ name: string; alt: string } | null>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  // The section a step is from, only when the steps come from more than one section.
  const sectioned = new Set(steps.map((s) => s.section)).size > 1;
  const next = () => setIndex((i) => Math.min(steps.length - 1, i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    if (all || zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, video")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setIndex((i) => Math.min(steps.length - 1, i + 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [all, zoom, steps.length]);

  return (
    <div className="mt-3 rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p data-step-label className="text-sm font-semibold text-ink">{all ? `All ${steps.length} steps` : `Step ${index + 1} of ${steps.length}`}</p>
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
              {s.image && <Shot name={s.image} label={`Enlarge the screenshot of step ${i + 1}`} alt={plain(s.text)} onZoom={setZoom} className="sm:w-72" />}
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-4 py-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
          <>
              {sectioned && step.section && <p className="mt-4 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{step.section}</p>}
              <div className="mt-2 flex gap-3">
                <StepNumber n={index + 1} large />
                <p className="max-w-prose pt-1 text-lg leading-relaxed text-ink"><Rich text={step.text} /></p>
              </div>
              {step.image && <Shot name={step.image} label={`Enlarge the screenshot of step ${index + 1}`} alt={plain(step.text)} onZoom={setZoom} className="mt-4" />}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5" aria-label="Steps">
                  {steps.map((_, i) => (
                    <button key={i} type="button" onClick={() => setIndex(i)} aria-label={`Step ${i + 1}`} aria-current={i === index ? "step" : undefined}
                            className={`h-2.5 rounded-full transition-all ${i === index ? "w-6 bg-accent" : i < index ? "w-2.5 bg-accent/50" : "w-2.5 bg-neutral-300 hover:bg-neutral-400"}`} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {step.page && <GoTo page={step.page} />}
                  <Button size="sm" variant="secondary" disabled={index === 0} onClick={back}><ChevronLeftIcon size={15} /> Back</Button>
                  {!last && <Button size="sm" variant="primary" onClick={next}>Next <ChevronRightIcon size={15} /></Button>}
                </div>
              </div>
          </>
        </div>
      )}
      {zoom && <Lightbox name={zoom.name} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </div>
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

// A step's screenshot (the step's text right above it says what it shows, so the picture itself needs no alt text);
// clicking it opens it full size.
function Shot({ name, label, alt, onZoom, className = "" }: { name: string; label: string; alt: string; onZoom: (zoom: { name: string; alt: string }) => void; className?: string }) {
  return (
    <button type="button" onClick={() => onZoom({ name, alt })} title="Click to enlarge" aria-label={label}
            className={`block w-full cursor-zoom-in overflow-hidden rounded-md border border-line bg-neutral-50 shadow-sm transition-shadow hover:shadow-md ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, signed-in users only */}
      <img src={imageUrl(name)} alt="" width={1440} height={761} loading="lazy" className="block h-auto w-full" />
    </button>
  );
}

function Lightbox({ name, alt, onClose }: { name: string; alt: string; onClose: () => void }) {
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
      <img src={imageUrl(name)} alt={alt.slice(0, 155)} className="max-h-full max-w-full rounded-md shadow-2xl" />
    </div>
  );
}

// Text with **bold** words (`strong`: their weight; lighter in long lists so labels don't crowd the line).
function Rich({ text, strong = "font-semibold" }: { text: string; strong?: string }) {
  const parts: ReactNode[] = text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i} className={`${strong} text-ink`}>{part.slice(2, -2)}</b> : part);
  return <>{parts}</>;
}

// The guide's video (shipped with the app, narrated), when it has one, with its captions (the player's CC button).
function VideoBlock({ topic }: { topic: HelpTopic }) {
  if (!topic.video) return null;
  return (
    <video key={topic.video.url} controls preload="metadata" width={1440} height={760} className="mt-3 h-auto w-full rounded-md border border-line bg-black" src={topic.video.url}>
      {topic.video.captions && <track kind="captions" src={topic.video.captions} srcLang="en" label="English" />}
      Your browser cannot play this video.
    </video>
  );
}
