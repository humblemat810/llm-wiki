export function normalizePublicOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

export function requirePublicOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = normalizePublicOrigin(value);
  if (!normalized) throw new Error("Public origin must be an absolute credential-free HTTP(S) origin.");
  return normalized;
}
