import { PASSWORD_RULES } from "@/lib/password";
import { CheckIcon } from "../icons";

// Live checklist of the password rules under a new-password field.
export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li key={rule.label} className={`flex items-center gap-1.5 ${ok ? "text-status-ok" : "text-ink-muted"}`}>
            {ok ? <CheckIcon size={13} /> : <span aria-hidden className="mx-[3px] h-1.5 w-1.5 rounded-full bg-neutral-300" />}
            <span>{rule.label}</span>
            <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
