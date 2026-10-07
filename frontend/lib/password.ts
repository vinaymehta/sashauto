// Password rules, the same as the backend's (User::MINIMUM_PASSWORD_LENGTH and User::PASSWORD_RULES).
export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_RULES: { label: string; test: (password: string) => boolean }[] = [
  { label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
];

// The first problem with a password (for a field error), or null when it meets every rule.
export function passwordProblem(password: string): string | null {
  if (password !== password.trim()) return "The password must not start or end with a space.";
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(password));
  return missing.length ? `The password needs: ${missing.map((r) => r.label.toLowerCase()).join(", ")}.` : null;
}

// A random 16-character password meeting every rule (letters and digits, no look-alike characters).
export function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  for (;;) {
    const values = crypto.getRandomValues(new Uint32Array(16));
    const password = Array.from(values, (v) => chars[v % chars.length]).join("");
    if (passwordProblem(password) === null) return password;
  }
}
