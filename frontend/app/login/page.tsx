"use client";

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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-base font-semibold text-white">OC</span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-base text-ink-muted">Order Change Tracker</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-surface p-6" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" htmlFor="email" error={emailError}>
            <Input id="email" type="email" autoComplete="username" autoFocus inputMode="email" className="w-full"
                   value={email} invalid={!!emailError} aria-describedby={emailError ? "email-error" : undefined}
                   onChange={(e) => { setEmail(e.target.value); setError(null); }}
                   onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
          </Field>
          <Field label="Password" htmlFor="password" error={passwordError}
                 hint={capsLock ? "Caps Lock is on." : undefined}>
            <div className="relative">
              <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" className="w-full pr-10"
                     value={password} invalid={!!passwordError} aria-describedby={passwordError ? "password-error" : undefined}
                     onChange={(e) => { setPassword(e.target.value); setError(null); }}
                     onKeyDown={onPasswordKey} onKeyUp={onPasswordKey}
                     onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint hover:text-ink">
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting && <Spinner className="border-white/40 border-t-white" />}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-faint">Accounts are created by an administrator.</p>
      </div>
    </div>
  );
}
