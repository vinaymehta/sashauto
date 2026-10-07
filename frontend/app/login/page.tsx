"use client";

import { BrandLogo } from "@/components/brand-logo";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "@/lib/api";
import { validateEmail, validatePassword } from "@/lib/validation";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { useSession } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert, Spinner } from "@/components/ui/feedback";

export default function LoginPage() {
  const { user, loading, signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password ? validatePassword(password) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (validateEmail(email) || validatePassword(password)) return;
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Try again.");
      setPassword("");
      setTouched((t) => ({ ...t, password: false }));
      setSubmitting(false);
    }
  }

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));

  return (
    <div className="flex min-h-screen bg-surface lg:h-screen">
      {/* Sign-in */}
      <div className="flex min-h-screen w-full flex-col px-6 py-8 sm:px-12 lg:h-screen lg:w-[46%] lg:overflow-y-auto lg:px-16 xl:px-24">
        <header className="flex items-center justify-between">
          <BrandLogo tone="dark" size="md" />
          <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-ink-faint">Supply portal</span>
        </header>

        <main className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">Sign in</h1>
            <p className="mt-2 text-base text-ink-muted">
              Welcome back. Sign in with the work email your administrator set up for you.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
              {error && <Alert>{error}</Alert>}
              <Field label="Work email" htmlFor="email" error={emailError}>
                <Input id="email" type="email" autoComplete="username" autoFocus inputMode="email" className="h-11 w-full"
                       placeholder="name@sashautotech.com"
                       value={email} invalid={!!emailError} aria-describedby={emailError ? "email-error" : undefined}
                       onChange={(e) => { setEmail(e.target.value); setError(null); }}
                       onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
              </Field>
              <Field label="Password" htmlFor="password" error={passwordError}
                     hint={capsLock ? "Caps Lock is on." : undefined}>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" className="h-11 w-full pr-11"
                         value={password} invalid={!!passwordError} aria-describedby={passwordError ? "password-error" : undefined}
                         onChange={(e) => { setPassword(e.target.value); setError(null); }}
                         onKeyDown={onPasswordKey} onKeyUp={onPasswordKey}
                         onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
                  <button type="button" onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-faint hover:text-ink">
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </Field>
              <Button type="submit" variant="primary" className="h-11 w-full" disabled={submitting}>
                {submitting && <Spinner className="border-white/40 border-t-white" />}
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="mt-6 text-sm text-ink-muted">
              No account yet? Accounts are created by an administrator — ask your admin for access.
            </p>
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <span>© {new Date().getFullYear()} Sash Autotech Pvt. Ltd.</span>
          <a href="https://www.sashautotech.com/" target="_blank" rel="noopener noreferrer" className="hover:text-ink">sashautotech.com</a>
        </footer>
      </div>

      <BrandPanel />
    </div>
  );
}

const INDUSTRIES = ["Construction & Forestry", "Agriculture", "Heavy-Duty Trucks"];
const OFFICES = [
  { city: "IMT Faridabad", region: "Haryana, India", note: "Headquarters" },
  { city: "Wood Dale", region: "Illinois, USA", note: "U.S. office" },
];

// Company side of the sign-in page (large screens only): who SASH is, and a sample of the order work done here.
function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-nav p-3 lg:block lg:h-screen lg:w-[54%]">
      <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-[#18202e] px-12 py-10 xl:px-16 xl:py-12 [@media(max-height:860px)]:py-8">
        {/* Faint grid and the SASH mark, enlarged, as texture. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]"
             style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <svg aria-hidden viewBox="0 0 48 51" className="pointer-events-none absolute -right-24 -bottom-20 h-[34rem] w-auto opacity-[0.06]" fill="#0aa1c0">
          <path d="M0.5 15.5 48 0v15.5z" /><path d="M13.5 17.5h16L15.5 34H0.5z" /><path d="M31 17.5h16.5L33.5 34H18z" /><path d="M0 36h47.5L0 51z" />
        </svg>

        <div className="relative">
          <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-[#0aa1c0]">Sash Autotech Pvt. Ltd.</p>
          <h2 className="mt-5 max-w-xl text-[2.25rem] font-semibold leading-[1.1] tracking-tight text-white xl:text-[2.6rem] [@media(max-height:860px)]:text-[1.9rem]">
            Wear part solutions for off-highway and on-highway vehicles.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-nav-text [@media(max-height:860px)]:mt-3 [@media(max-height:860px)]:text-sm">
            Customer schedules, quantity and address changes, MOQ checks and vendor orders — the supply team&apos;s
            daily work, in one place, from Faridabad to the final destination.
          </p>
          <ul className="mt-7 flex flex-wrap gap-2 [@media(max-height:860px)]:hidden">
            {INDUSTRIES.map((industry) => (
              <li key={industry} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-nav-text">
                {industry}
              </li>
            ))}
          </ul>
        </div>

        <OrderPreview />

        <div className="relative mt-8 grid grid-cols-3 gap-6 border-t border-white/10 pt-5 xl:mt-10 xl:pt-6 [@media(max-height:860px)]:mt-6 [@media(max-height:860px)]:pt-4">
          {OFFICES.map((office) => (
            <div key={office.city}>
              <p className="text-sm font-semibold text-white">{office.city}</p>
              <p className="text-xs text-nav-text">{office.region}</p>
              <p className="mt-1 text-2xs uppercase tracking-wider text-white/40">{office.note}</p>
            </div>
          ))}
          <div>
            <p className="text-sm font-semibold text-white">500+ suppliers</p>
            <p className="text-xs text-nav-text">Across manufacturing capabilities</p>
            <p className="mt-1 text-2xs uppercase tracking-wider text-white/40">Supply solutions</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// An illustrative order line (sample data): a quantity change detected on upload, then placed with vendors.
function OrderPreview() {
  const steps = ["Schedule received", "Change detected", "MOQ checked", "Vendor order sent"];
  return (
    <div aria-hidden className="relative mt-auto pt-8 xl:pt-12 [@media(max-height:860px)]:pt-6">
      <div className="max-w-md rounded-xl bg-white p-5 shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between font-mono text-xs text-ink-muted">
          <span>PO 5500922584 · LINE 00010</span>
          <span className="inline-flex items-center gap-1.5 font-sans font-medium text-[#17693f]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#17693f]" />Placed
          </span>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-lg font-semibold text-ink">JXRE62658</p>
            <p className="text-xs text-ink-muted">Firm · Ship 15 Jan 2027 · DY_RT047299888</p>
          </div>
          <div className="text-right">
            <p className="tabular text-sm text-ink-muted"><span className="line-through">150</span> → <span className="font-semibold text-ink">250</span></p>
            <p className="tabular text-xs font-semibold text-[#17693f]">↑ +100</p>
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-4 gap-2">
          {steps.map((step) => (
            <li key={step} className="relative">
              <span className="block h-1 rounded-full bg-[#0aa1c0]" />
              <span className="mt-2 block text-[10px] font-medium uppercase leading-tight tracking-wide text-ink-muted">{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 [@media(max-height:860px)]:hidden">Sample order line · Faridabad → Distribution center</p>
    </div>
  );
}
