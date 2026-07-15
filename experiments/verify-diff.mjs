import { DIFF_FORMAT, diffGraphs, parseJsonWithUniqueKeys, parseTimestamp } from "../graph-core.js";
import { MAX_GRAPH_INPUT_BYTES, readGraphInput } from "./graph-input.mjs";
import { readBoundedTextFile } from "./bounded-file.mjs";

const [beforePath, afterPath, diffPath, ...options] = process.argv.slice(2);
const usage = "Usage: node experiments/verify-diff.mjs <before-graph-or-backup.json> <after-graph-or-backup.json> <diff.json>";

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((left, right) => {
        const leftSerialized = JSON.stringify(left);
        const rightSerialized = JSON.stringify(right);
        return leftSerialized < rightSerialized ? -1 : leftSerialized > rightSerialized ? 1 : 0;
      });
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!beforePath || !afterPath || !diffPath || options.length) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const before = await readGraphInput(beforePath, { label: "Diff verification input" });
    const after = await readGraphInput(afterPath, { label: "Diff verification input" });
    const diff = parseJsonWithUniqueKeys(await readBoundedTextFile(diffPath, MAX_GRAPH_INPUT_BYTES, {
      label: "Graph diff",
      tooLargeMessage: `Graph diff exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${diffPath}`
    }), "Graph diff");
    if (!diff || typeof diff !== "object" || diff.format !== DIFF_FORMAT) {
      throw new Error(`Graph diff must declare ${DIFF_FORMAT}: ${diffPath}`);
    }
    if (typeof diff.exportedAt !== "string" || Number.isNaN(parseTimestamp(diff.exportedAt))) {
      throw new Error("Graph diff exportedAt must be a valid timestamp.");
    }
    const expected = diffGraphs(before, after);
    const actual = { ...diff };
    delete actual.exportedAt;
    if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
      throw new Error("Graph diff does not match the normalized before/after graph inputs.");
    }
    console.log(JSON.stringify({
      verified: true,
      format: DIFF_FORMAT,
      fromVersion: expected.fromVersion,
      toVersion: expected.toVersion,
      fromFingerprint: expected.fromFingerprint,
      toFingerprint: expected.toFingerprint,
      changed: expected.changed
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Graph diff verification failed.");
    process.exitCode = 1;
  }
}
