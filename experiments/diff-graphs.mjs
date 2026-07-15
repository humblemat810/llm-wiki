import { DIFF_FORMAT, diffGraphs } from "../graph-core.js";
import { readGraphInput } from "./graph-input.mjs";

const [beforePath, afterPath] = process.argv.slice(2);
const usage = "Usage: node experiments/diff-graphs.mjs <before-graph-or-backup.json> <after-graph-or-backup.json>";

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!beforePath || !afterPath) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const before = await readGraphInput(beforePath, { label: "Graph diff input" });
    const after = await readGraphInput(afterPath, { label: "Graph diff input" });
    console.log(JSON.stringify({ ...diffGraphs(before, after), exportedAt: new Date().toISOString(), format: DIFF_FORMAT }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Graph diff failed.");
    process.exitCode = 1;
  }
}
