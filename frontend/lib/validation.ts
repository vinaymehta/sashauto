// Client-side checks mirror the server's rules so users get immediate, field-level feedback.
// The server remains the authority and re-validates every request.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PART_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!EMAIL.test(v)) return "Enter a valid email address, e.g. name@company.com.";
  return null;
}

export function validatePassword(value: string): string | null {
  return value ? null : "Enter your password.";
}

export function validatePartNumber(value: string): string | null {
  const v = value.trim();
  if (!v) return "Part Number is required.";
  if (v.length > 100) return "Part Number must be 100 characters or fewer.";
  if (!PART_NUMBER.test(v)) return "Use only letters, digits, spaces and . _ / - (must start with a letter or digit).";
  return null;
}

export function validateCommodityType(value: string): string | null {
  return value.trim().length > 100 ? "Commodity Type must be 100 characters or fewer." : null;
}

// Maps Rails `errors.to_hash` details ({ part_number: ["has already been taken"] }) to field messages.
export function serverFieldErrors(details: unknown, labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!details || typeof details !== "object") return out;
  for (const [field, messages] of Object.entries(details as Record<string, string[]>)) {
    if (Array.isArray(messages) && messages.length) out[field] = `${labels[field] ?? field} ${messages[0]}.`;
  }
  return out;
}
