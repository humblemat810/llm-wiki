export const DEFAULT_PUBLIC_REPOSITORY = "https://github.com/humblemat810/llm-wiki";

export function normalizePublicRepository(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_PUBLIC_REPOSITORY;
  const candidate = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com"
      || url.username || url.password || url.search || url.hash
      || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url.pathname)) {
      return "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function requirePublicRepository(value) {
  const normalized = normalizePublicRepository(value);
  if (!normalized) throw new Error("Public repository must be an absolute credential-free GitHub HTTPS repository URL.");
  return normalized;
}
