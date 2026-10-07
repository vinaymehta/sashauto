"use client";

import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { ApiError } from "@/lib/api";
import { passwordProblem } from "@/lib/password";
import { EyeIcon, EyeOffIcon } from "../icons";
import { useSession } from "../session";
import { Button } from "../ui/button";
import { Alert, Spinner } from "../ui/feedback";
import { Field, Input } from "../ui/field";
import { PasswordRules } from "./password-rules";

// The signed-in user chooses a new password (current password, new password, confirmation). Used after an
// admin created or reset the account (required before using the app) and from the user menu.
export function ChangePasswordForm({ onDone, submitLabel = "Change password" }: { onDone?: () => void; submitLabel?: string }) {
  const { changePassword } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problems: typeof errors = {};
    if (!current) problems.current = "Enter your current password.";
    const problem = passwordProblem(next);
    if (problem) problems.next = problem;
    else if (next === current) problems.next = "Choose a password different from the current one.";
    if (confirm !== next) problems.confirm = "The passwords do not match.";
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      await changePassword(current, next);
      onDone?.();
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { new_password?: string[] } | undefined) : undefined;
      if (err instanceof ApiError && err.code === "invalid_current_password") setErrors({ current: "This is not your current password." });
      else if (details?.new_password?.length) setErrors({ next: `The password ${details.new_password.join(" and ")}.` });
      else setError(err instanceof ApiError ? err.message : "Could not change the password.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Current password" htmlFor="current-password" error={errors.current}>
        <PasswordInput id="current-password" autoComplete="current-password" autoFocus
                       value={current} invalid={!!errors.current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" htmlFor="new-password" error={errors.next}>
        <PasswordInput id="new-password" autoComplete="new-password"
                       value={next} invalid={!!errors.next} onChange={(e) => setNext(e.target.value)} />
        <PasswordRules password={next} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-password" error={errors.confirm}>
        <PasswordInput id="confirm-password" autoComplete="new-password"
                       value={confirm} invalid={!!errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" className="h-10 w-full" disabled={saving}>
        {saving && <Spinner className="border-white/40 border-t-white" />}
        {saving ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

// A password input with its own show/hide button.
function PasswordInput({ invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} invalid={invalid} className="h-10 w-full pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint hover:text-ink">
        {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
    </div>
  );
}
