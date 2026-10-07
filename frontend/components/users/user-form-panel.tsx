"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { generatePassword, passwordProblem } from "@/lib/password";
import type { Role, User, UserCredentialsResponse } from "@/lib/types";
import { EyeIcon, EyeOffIcon, KeyIcon, UsersIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Field, Input, Select } from "../ui/field";
import { Sheet } from "../ui/sheet";
import { PasswordRules } from "./password-rules";

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", warehouse_manager: "Warehouse Manager" };
const ROLE_HINT: Record<Role, string> = {
  admin: "Everything, including users, vendors, manual orders, MOQ and vendor orders.",
  warehouse_manager: "Orders, uploads, products and vendors (view), without admin changes.",
};

// Side panel to add a user (`user` absent) or edit one. A new user gets their password by email and must choose
// their own at first sign-in; leave the password blank to have one generated. Editing also offers the account
// actions: reset password (`onResetPassword`) and deactivate/reactivate (`onToggleActive`, not for yourself).
export function UserFormPanel({ user, isSelf = false, onClose, onSaved, onResetPassword, onToggleActive }: {
  user?: User; isSelf?: boolean; onClose: () => void; onSaved: () => void;
  onResetPassword?: () => void; onToggleActive?: () => void;
}) {
  const notify = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "warehouse_manager");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<UserCredentialsResponse | null>(null);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = "Enter the name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) problems.email = "Enter a valid email address.";
    if (!user && password) problems.password = passwordProblem(password) ?? "";
    if (!problems.password) delete problems.password;
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), email: email.trim(), role };
      if (user) {
        await api.patch(`/api/users/${user.id}`, body);
        notify(`${name.trim()} updated.`);
        onSaved();
        onClose();
        return;
      }
      const res = await api.post<UserCredentialsResponse>("/api/users", { ...body, password: password || undefined });
      onSaved();
      if (res.email_sent) {
        notify(`${res.data.name} added. Sign-in details were emailed to ${res.data.email}.`);
        onClose();
      } else {
        setResult(res);
      }
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        const details = err.details as Record<string, string[]>;
        const labels: Record<string, string> = { email: "Email", name: "Name", role: "Role", password: "The password" };
        setErrors(Object.fromEntries(Object.entries(details).map(([k, v]) => [k, `${labels[k] ?? "This"} ${v.join(" and ")}.`])));
      }
      setError(err instanceof ApiError ? err.message : "Could not save the user.");
      setSaving(false);
    }
  }

  if (result) return <CredentialsResult result={result} title="User added" onClose={onClose} />;

  return (
    <Sheet
      open
      onClose={onClose}
      title={user ? "Edit user" : "Add user"}
      description={user ? user.email : "They receive their sign-in details by email and choose their own password at first sign-in."}
      icon={<UsersIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : user ? "Save" : "Add user"}</Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-white px-5 py-5 shadow-card" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Name" htmlFor="user-name" error={errors.name} required>
          <Input id="user-name" autoFocus value={name} maxLength={200} invalid={!!errors.name} className="w-full"
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="user-email" error={errors.email} required
               hint={user ? "Changing it changes the address they sign in with." : undefined}>
          <Input id="user-email" type="email" value={email} maxLength={254} invalid={!!errors.email} className="w-full"
                 placeholder="name@sashautotech.com" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="user-role" hint={ROLE_HINT[role]} required>
          <Select id="user-role" className="w-full" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        {!user && (
          <PasswordField value={password} onChange={setPassword} error={errors.password}
                         hint="Leave blank to generate one. It is emailed to the user." />
        )}
        <button type="submit" hidden />
      </form>
      {user && (
        <section className="mt-4 overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <h3 className="border-b border-neutral-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Account</h3>
          <div className="divide-y divide-neutral-100">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-ink">Reset password</p>
                <p className="text-xs text-ink-muted">Email a new temporary password; they choose their own at next sign-in.</p>
              </div>
              <Button size="sm" onClick={onResetPassword} disabled={!user.active || saving}>
                <KeyIcon size={14} className="text-ink-muted" />Reset
              </Button>
            </div>
            {!isSelf && (
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-ink">{user.active ? "Deactivate account" : "Reactivate account"}</p>
                  <p className="text-xs text-ink-muted">
                    {user.active ? "They can no longer sign in and are signed out now. Their history stays." : "They can sign in again with their current password."}
                  </p>
                </div>
                <Button size="sm" onClick={onToggleActive} disabled={saving}
                        className={user.active ? "text-status-fail hover:text-status-fail" : ""}>
                  {user.active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </Sheet>
  );
}

// Side panel to set a new password for a user: emailed to them, and they must choose their own at next sign-in.
// Their open sessions are signed out.
export function ResetPasswordPanel({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<UserCredentialsResponse | null>(null);

  async function reset(e?: FormEvent) {
    e?.preventDefault();
    const problem = password ? passwordProblem(password) : null;
    if (problem) return setFieldError(problem);
    setFieldError(undefined);
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<UserCredentialsResponse>(`/api/users/${user.id}/reset_password`, { password: password || undefined });
      onSaved();
      if (res.email_sent) {
        notify(`New password emailed to ${user.email}.`);
        onClose();
      } else {
        setResult(res);
      }
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { password?: string[] } | undefined) : undefined;
      if (details?.password?.length) setFieldError(`The password ${details.password.join(" and ")}.`);
      setError(err instanceof ApiError ? err.message : "Could not reset the password.");
      setSaving(false);
    }
  }

  if (result) return <CredentialsResult result={result} title="Password reset" onClose={onClose} />;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Reset password"
      description={`${user.name} · ${user.email}`}
      icon={<KeyIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => reset()} disabled={saving}>{saving ? "Sending…" : "Reset and email"}</Button>
        </>
      }
    >
      <form onSubmit={reset} className="space-y-4 rounded-lg border border-line bg-white px-5 py-5 shadow-card" noValidate>
        {error && <Alert>{error}</Alert>}
        <Alert tone="info">
          The new password is emailed to {user.email}. Their current password stops working, they are signed out
          everywhere, and they must choose their own password at the next sign-in.
        </Alert>
        <PasswordField value={password} onChange={setPassword} error={fieldError} hint="Leave blank to generate one." />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function PasswordField({ value, onChange, error, hint }: { value: string; onChange: (v: string) => void; error?: string; hint: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field label="Password" htmlFor="user-password" error={error} hint={hint} optional>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input id="user-password" type={show ? "text" : "password"} autoComplete="new-password" value={value} invalid={!!error}
                 className="w-full pr-10 font-mono" onChange={(e) => onChange(e.target.value)} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint hover:text-ink">
            {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
        <Button type="button" onClick={() => { onChange(generatePassword()); setShow(true); }}>Generate</Button>
      </div>
      {value && <PasswordRules password={value} />}
    </Field>
  );
}

// Shown when the sign-in email could not be sent: the account is saved, and the password is shown once to share.
function CredentialsResult({ result, title, onClose }: { result: UserCredentialsResponse; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet open onClose={onClose} title={title} description={`${result.data.name} · ${result.data.email}`} icon={<KeyIcon size={18} />}
           footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <Alert tone="warning" title="The email could not be sent">{result.email_error}</Alert>
        <div className="rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">Temporary password</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <code className="text-lg font-semibold text-ink">{result.password}</code>
            <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(result.password ?? ""); setCopied(true); }}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Shown only now. They must choose their own password at first sign-in.</p>
        </div>
      </div>
    </Sheet>
  );
}
