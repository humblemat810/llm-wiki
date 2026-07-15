import { FEEDBACK_FORMAT, GRAPH_SCHEMA, MAX_FEEDBACK_EXPORT_OMITTED, matchesFeedbackFingerprint, matchesGraphFingerprint, parseJsonWithUniqueKeys } from "../graph-core.js";
import { evaluateExtraction, MAX_EVALUATION_EXAMPLES } from "../evaluation.js";
import { readBoundedTextFile } from "./bounded-file.mjs";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const args = process.argv.slice(2);
const feedbackPath = args.shift();
const extractionPath = args.shift();
const usage = "Usage: node experiments/evaluate-feedback.mjs <feedback.json> <extraction-or-graph.json> [--max-untrusted-feedback <integer>]";

function parseOptions(values) {
  let maxUntrustedFeedback = null;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== "--max-untrusted-feedback") {
      throw new Error(`Unknown option: ${values[index]}`);
    }
    const raw = values[++index];
    const value = Number(raw);
    if (!raw || !Number.isSafeInteger(value) || value < 0 || value > MAX_EVALUATION_EXAMPLES) {
      throw new Error(`--max-untrusted-feedback must be an integer from 0 to ${MAX_EVALUATION_EXAMPLES}.`);
    }
    maxUntrustedFeedback = value;
  }
  return { maxUntrustedFeedback };
}

async function readJsonFile(path) {
  return parseJsonWithUniqueKeys(await readBoundedTextFile(path, MAX_INPUT_BYTES, {
    label: "Evaluation input",
    tooLargeMessage: `Evaluation input exceeds the ${MAX_INPUT_BYTES / (1024 * 1024)} MB safety limit: ${path}`
  }), `Evaluation input ${path}`);
}

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!feedbackPath || !extractionPath) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const { maxUntrustedFeedback } = parseOptions(args);
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
    if (!Array.isArray(feedback) && feedback.truncatedExamples !== undefined
      && (!Number.isSafeInteger(feedback.truncatedExamples) || feedback.truncatedExamples < 0 || feedback.truncatedExamples > MAX_FEEDBACK_EXPORT_OMITTED)) {
      throw new Error("Feedback JSON contains an invalid truncation diagnostic.");
    }
    if (!Array.isArray(feedback) && feedback.truncatedExamples > 0) {
      throw new Error(`Feedback JSON is a partial export: ${feedback.truncatedExamples} reviewed examples were omitted. Evaluation requires a complete reviewed dataset.`);
    }
    if (!Array.isArray(feedback) && feedback.datasetFingerprint !== undefined
      && !matchesFeedbackFingerprint(examples, feedback.datasetFingerprint)) {
      throw new Error("Feedback JSON dataset fingerprint does not match its examples.");
    }
    const report = evaluateExtraction(extractionValue, examples);
    if (maxUntrustedFeedback !== null && report.feedback.untrustedExamples > maxUntrustedFeedback) {
      throw new Error(`untrusted feedback examples ${report.feedback.untrustedExamples} exceed ${maxUntrustedFeedback}`);
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Evaluation failed.");
    process.exitCode = 1;
  }
}
