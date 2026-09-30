const dateTime = new Intl.DateTimeFormat("en-GB", {
  year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const date = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
const integer = new Intl.NumberFormat("en-US");
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function formatDateTime(value: string | null | undefined) {
  return value ? dateTime.format(new Date(value)) : "—";
}

// Ship dates are calendar dates (YYYY-MM-DD) and must not shift with the viewer's time zone.
export function formatDate(value: string | null | undefined) {
  return value ? date.format(new Date(`${value}T00:00:00Z`)) : "—";
}

const dateOnly = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric" });

// Date part of a timestamp in the viewer's time zone, e.g. "29 Sept 2026".
export function formatDateOnly(value: string | null | undefined) {
  return value ? dateOnly.format(new Date(value)) : "—";
}

export function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : integer.format(value);
}

// Quantities arrive as decimal strings to preserve precision; display only.
export function formatQty(value: string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return decimal.format(Number(value));
}

export function formatDifference(value: string) {
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${decimal.format(n)}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function versionLabel(version: number | null | undefined) {
  return version ? `V${version}` : "—";
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(value: string | null | undefined) {
  if (!value) return "—";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 7) return relative.format(Math.round(seconds / 86400), "day");
  return formatDateTime(value);
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const shortTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

// Compact two-part label for an upload, e.g. ["29 Sept", "16:05"] (chart axes).
export function formatUploadParts(value: string) {
  const d = new Date(value);
  return [shortDate.format(d), shortTime.format(d)] as const;
}
