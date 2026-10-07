/**
 * Origin allowlist, e.g. "https://maptogether.io,https://*--maptogether.netlify.app".
 * `*` matches one DNS label (letters, digits, hyphens).
 */
export function isAllowedOrigin(origin: string | null, allowlist: string): boolean {
  if (!origin) return false;
  return allowlist
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .some((pattern) => toRegExp(pattern).test(origin));
}

function toRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[a-z0-9-]+");
  return new RegExp(`^${escaped}$`);
}
