import { readFile, stat } from "node:fs/promises";
import { FEEDBACK_FORMAT, GRAPH_SCHEMA, matchesFeedbackFingerprint, matchesGraphFingerprint } from "../graph-core.js";
import { evaluateExtraction } from "../evaluation.js";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const [feedbackPath, extractionPath] = process.argv.slice(2);

async function readJsonFile(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Evaluation input is not a file: ${path}`);
  if (metadata.size > MAX_INPUT_BYTES) throw new Error(`Evaluation input exceeds the ${MAX_INPUT_BYTES / (1024 * 1024)} MB safety limit: ${path}`);
  return JSON.parse(await readFile(path, "utf8"));
}

if (!feedbackPath || !extractionPath) {
  console.error("Usage: node experiments/evaluate-feedback.mjs <feedback.json> <extraction-or-graph.json>");
  process.exitCode = 1;
} else {
  try {
    const feedback = await readJsonFile(feedbackPath);
    const extraction = await readJsonFile(extractionPath);
    if (!Array.isArray(feedback) && feedback?.format !== undefined && feedback.format !== FEEDBACK_FORMAT) {
      throw new Error("Feedback JSON declares an incompatible feedback format.");
    }
    if (!Array.isArray(feedback) && feedback?.graphSchema !== undefined && feedback.graphSchema !== GRAPH_SCHEMA) {
      throw new Error("Feedback JSON declares an incompatible graph schema.");
    }
    const extractionValue = extraction?.extraction || extraction;
    if (extraction?.schema !== undefined && extraction.schema !== GRAPH_SCHEMA) {
      throw new Error("Extraction JSON declares an incompatible graph schema.");
    }
    if (extractionValue?.schema !== undefined && extractionValue.schema !== GRAPH_SCHEMA) {
      throw new Error("Extraction payload declares an incompatible graph schema.");
    }
    if (extractionValue?.schema === GRAPH_SCHEMA
      && extractionValue.graphFingerprint !== undefined
      && !matchesGraphFingerprint(extractionValue, extractionValue.graphFingerprint)) {
      throw new Error("Extraction graph fingerprint does not match its contents.");
    }
    const examples = Array.isArray(feedback) ? feedback : feedback.examples;
    if (!Array.isArray(examples)) throw new Error("Feedback JSON must be an array or contain an examples array.");
    if (!Array.isArray(feedback) && feedback.datasetFingerprint !== undefined
      && !matchesFeedbackFingerprint(examples, feedback.datasetFingerprint)) {
      throw new Error("Feedback JSON dataset fingerprint does not match its examples.");
    }
    console.log(JSON.stringify(evaluateExtraction(extractionValue, examples), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Evaluation failed.");
    process.exitCode = 1;
  }
}
