import { createReadStream } from "node:fs";
import { encodeSharePayload, validateSharePayload } from "../share-projection.js";
import { parseJsonWithUniqueKeys } from "../graph-core.js";

const MAX_INPUT_BYTES = 1024 * 1024;
const readBounded = async (source) => {
  const stream = source === "-" ? process.stdin : createReadStream(source);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > MAX_INPUT_BYTES) {
        stream.destroy?.();
        throw new Error(`share JSON exceeds the ${MAX_INPUT_BYTES} byte verifier limit`);
      }
      chunks.push(bytes);
    }
  } finally {
    if (source !== "-" && typeof stream.close === "function") stream.close();
  }
  return Buffer.concat(chunks, total);
};

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/verify-share.mjs <share.json | ->");
  process.exitCode = 2;
} else {
  const bytes = await readBounded(source);
  const payload = parseJsonWithUniqueKeys(bytes.toString("utf8"), "share JSON");
  validateSharePayload(payload);
  encodeSharePayload(payload);
  console.log(`share verifier ok: ${payload.nodes.length} concepts, ${payload.edges.length} relations`);
}
