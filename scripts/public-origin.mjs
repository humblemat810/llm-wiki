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

export function requirePublicOrigin(value, { requireSecure = false, allowLoopbackHttp = true } = {}) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = normalizePublicOrigin(value);
  if (!normalized) throw new Error("Public origin must be an absolute credential-free HTTP(S) origin.");
  if (requireSecure) {
    const parsed = new URL(normalized);
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol !== "https:" && !(allowLoopbackHttp && loopback)) {
      throw new Error("Public origin must use HTTPS outside loopback development.");
    }
  }
  return normalized;
}
