import { open, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function readBoundedTextFile(path, maxBytes, {
  label = "Input",
  tooLargeMessage = `${label} exceeds the configured size limit: ${path}`
} = {}) {
  const numericLimit = Number(maxBytes);
  if (!Number.isFinite(numericLimit) || numericLimit < 1) throw new RangeError("A finite positive file-size limit is required.");
  const byteLimit = Math.floor(numericLimit);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label} is not a file: ${path}`);
  if (metadata.size > byteLimit) throw new Error(tooLargeMessage);
  const handle = await open(path, "r");
  const chunks = [];
  let total = 0;
  try {
    const chunkSize = Math.min(64 * 1024, byteLimit + 1);
    while (total <= byteLimit) {
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > byteLimit) throw new Error(tooLargeMessage);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
    } catch {
      throw new Error(`${label} is not valid UTF-8: ${path}`);
    }
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url && process.argv.includes("--help")) {
  console.log("Usage: node experiments/bounded-file.mjs --help");
  console.log("Library boundary: import readBoundedTextFile(path, maxBytes) from this module for fatal UTF-8 reads.");
}
