import { buildJsonLd, matchesJsonLdProjection } from "../jsonld-projection.js";
import { parseJsonWithUniqueKeys } from "../graph-core.js";
import { MAX_GRAPH_INPUT_BYTES, readGraphInput } from "./graph-input.mjs";
import { readBoundedTextFile } from "./bounded-file.mjs";

const [graphPath, projectionPath, ...options] = process.argv.slice(2);
const usage = "Usage: node experiments/verify-jsonld.mjs <graph-or-backup.json> <projection.jsonld>";

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!graphPath || !projectionPath || options.length) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const graph = await readGraphInput(graphPath);
    const projection = parseJsonWithUniqueKeys(await readBoundedTextFile(projectionPath, MAX_GRAPH_INPUT_BYTES, {
      label: "JSON-LD projection",
      tooLargeMessage: `JSON-LD projection exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${projectionPath}`
    }), "JSON-LD projection");
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
