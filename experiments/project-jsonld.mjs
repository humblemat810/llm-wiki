import { redactGraph } from "../graph-core.js";
import { buildJsonLd } from "../jsonld-projection.js";
import { readGraphInput } from "./graph-input.mjs";
const [inputPath, ...options] = process.argv.slice(2);

if (!inputPath || options.some((option) => option !== "--redacted")) {
  console.error("Usage: node experiments/project-jsonld.mjs <graph-or-backup.json> [--redacted]");
  process.exitCode = 1;
} else {
  try {
    const graph = await readGraphInput(inputPath, { label: "JSON-LD input" });
    console.log(JSON.stringify(buildJsonLd(options.includes("--redacted") ? redactGraph(graph) : graph), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "JSON-LD projection failed.");
    process.exitCode = 1;
  }
}
