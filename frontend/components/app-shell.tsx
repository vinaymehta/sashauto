"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BoxIcon, CloseIcon, DashboardIcon, MenuIcon, TableIcon, TruckIcon, UsersIcon } from "./icons";
import { BrandLogo } from "./brand-logo";
import { ChangePasswordForm } from "./users/change-password-form";
import { NotificationBell } from "./notification-bell";
import { useSession } from "./session";
import { ToastProvider } from "./toast";
import { Skeleton } from "./ui/skeleton";
import { useDismiss } from "./use-dismiss";
import { UserMenu } from "./user-menu";

const NAV = [
  { href: "/", label: "Dashboard", icon: DashboardIcon, match: (p: string) => p === "/" },
  { href: "/orders", label: "Orders", icon: TableIcon, match: (p: string) => p.startsWith("/orders") || p.startsWith("/uploads") },
  { href: "/products", label: "Products", icon: BoxIcon, match: (p: string) => p.startsWith("/products") },
  { href: "/vendors", label: "Vendors", icon: TruckIcon, match: (p: string) => p.startsWith("/vendors") },
  { href: "/users", label: "Users", icon: UsersIcon, match: (p: string) => p.startsWith("/users"), adminOnly: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useDismiss(drawer, drawerOpen, closeDrawer);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const ready = !loading && !!user;
  const items = NAV.filter((item) => !item.adminOnly || user?.role === "admin");
  const current = items.find((item) => item.match(pathname));

  // An account created or reset by an admin chooses its own password before anything else.
  if (ready && user.must_change_password) {
    return <RequiredPasswordChange name={user.name} onSignOut={() => { void signOut().then(() => router.replace("/login")); }} />;
  }

  const nav = (
    <nav className="space-y-1">
      {items.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link key={href} href={href} onClick={closeDrawer} aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-base transition-all duration-150 ${
                  active
                    ? "bg-nav-raised font-semibold text-white"
                    : "font-normal text-nav-text hover:bg-white/5 hover:text-white"
                }`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              active ? "text-white" : "text-nav-text/70"
            }`}>
              <Icon size={15} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <ToastProvider>
      <div className="min-h-screen lg:flex">
        <aside className="hidden w-60 shrink-0 border-r border-nav-line bg-nav lg:sticky lg:top-0 lg:block lg:h-screen">
          <div className="flex h-14 items-center border-b border-nav-line bg-nav px-4"><Brand /></div>
          <div className="px-3 py-4">{nav}</div>
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 animate-fade-in bg-ink/25 lg:hidden">
            <div ref={drawer} className="h-full w-72 animate-slide-in border-r border-nav-line bg-nav shadow-modal">
              <div className="flex h-14 items-center justify-between border-b border-nav-line bg-nav px-4">
                <Brand />
                <button onClick={closeDrawer} aria-label="Close menu" className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white"><CloseIcon size={18} /></button>
              </div>
              <div className="px-3 py-4">{nav}</div>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-nav-line bg-nav px-4 text-white sm:px-6">
            <button onClick={() => setDrawerOpen(true)} aria-label="Open menu"
                    className="-ml-1 rounded-md p-1.5 text-neutral-300 hover:bg-white/10 hover:text-white lg:hidden">
              <MenuIcon />
            </button>
            <div className="lg:hidden"><Brand compact /></div>
            <p className="hidden text-base font-medium text-neutral-300 lg:block">{current?.label}</p>
            <div className="ml-auto flex items-center gap-1">
              {ready ? (
                <>
                  <NotificationBell />
                  <div className="mx-1 h-6 w-px bg-white/15" />
                  <UserMenu />
                </>
              ) : (
                <>
                  <div className="h-8 w-8 animate-shimmer rounded-md bg-white/10" />
                  <div className="mx-1 h-6 w-px bg-white/15" />
                  <div className="h-8 w-36 animate-shimmer rounded-md bg-white/10" />
                </>
              )}
            </div>
          </header>
          <main className="flex-1 px-4 py-5 sm:px-6">
            {/* Keyed by path so each page fades in instead of snapping into place. */}
            <div key={pathname} className="animate-fade-in">
              {ready ? children : (
                <div role="status" aria-label="Loading">
                  <Skeleton className="h-7 w-48" />
                  <Skeleton className="mt-3 h-4 w-96 max-w-full" />
                  <Skeleton className="mt-8 h-40 w-full rounded-lg" />
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}

function RequiredPasswordChange({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <BrandLogo tone="dark" size="md" />
        <div className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Choose your password</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Welcome, {name}. You signed in with a temporary password from your administrator. Choose your own
            password to continue.
          </p>
          <div className="mt-6"><ChangePasswordForm submitLabel="Save and continue" /></div>
        </div>
        <button type="button" onClick={onSignOut} className="mt-4 text-sm text-ink-muted hover:text-ink">Sign out</button>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="SASH Order Change Tracker home" className="flex items-center">
      <BrandLogo tone="light" size={compact ? "sm" : "md"} />
    </Link>
  );
}
