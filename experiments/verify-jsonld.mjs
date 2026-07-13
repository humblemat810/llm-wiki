import { readFile, stat } from "node:fs/promises";
import { buildJsonLd, matchesJsonLdProjection } from "../jsonld-projection.js";
import { MAX_GRAPH_INPUT_BYTES, readGraphInput } from "./graph-input.mjs";

const [graphPath, projectionPath, ...options] = process.argv.slice(2);

if (!graphPath || !projectionPath || options.length) {
  console.error("Usage: node experiments/verify-jsonld.mjs <graph-or-backup.json> <projection.jsonld>");
  process.exitCode = 1;
} else {
  try {
    const graph = await readGraphInput(graphPath);
    const metadata = await stat(projectionPath);
    if (!metadata.isFile()) throw new Error(`JSON-LD projection is not a file: ${projectionPath}`);
    if (metadata.size > MAX_GRAPH_INPUT_BYTES) throw new Error(`JSON-LD projection exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${projectionPath}`);
    const projection = JSON.parse(await readFile(projectionPath, "utf8"));
    if (!matchesJsonLdProjection(graph, projection)) {
      throw new Error("JSON-LD projection does not match the normalized graph input.");
    }
    const expected = buildJsonLd(graph);
    console.log(JSON.stringify({
      verified: true,
      format: expected.format,
      graphVersion: expected.graphVersion,
      fingerprint: expected.fingerprint,
      redacted: expected.redacted
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "JSON-LD verification failed.");
    process.exitCode = 1;
  }
}
