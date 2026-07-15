import { pathToFileURL } from "node:url";
import {
  MAX_CONCEPT_LABEL_CHARS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_FEEDBACK_EXAMPLES,
  MAX_ID_CHARS,
  applyFeedback,
  buildExtractorFeedback,
  defaultGraph,
  extractGraph,
  mergeExtraction
} from "../graph-core.js";

const FIRST_DOCUMENT = "Retrieval loop gives the model relevant context. The retrieval loop uses source citations.";
const FOLLOW_UP_DOCUMENT = "The retrieval loop improves answer quality. This loop also connects citations to context.";

function requireNode(graph, id) {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`The learning-loop example expected concept "${id}".`);
  return node;
}

function labels(graph) {
  return graph.nodes.map((node) => node.label).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function assertOnlyKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

const validBounded = (value, maximum) => typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
const validConceptLabel = (value) => validBounded(value, MAX_CONCEPT_LABEL_CHARS);
const validId = (value) => validBounded(value, MAX_ID_CHARS);

export function validateLearningLoopOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Learning-loop output must be an object.");
  assertOnlyKeys(value, ["format", "stages", "proof"], "Learning-loop output");
  if (value.format !== "llm-field-notes/learning-loop@1") throw new Error("Learning-loop output format is unsupported.");
  const stages = value.stages;
  if (!stages || typeof stages !== "object" || Array.isArray(stages)) throw new Error("Learning-loop stages are missing.");
  assertOnlyKeys(stages, ["initial", "reviewed", "improved", "comparison"], "Learning-loop stages");
  for (const key of ["initial", "improved"]) {
    const stage = stages[key];
    assertOnlyKeys(stage, ["concepts", "labels", "relations"], `Learning-loop ${key} stage`);
    if (!stage || typeof stage !== "object" || !Number.isSafeInteger(stage.concepts) || stage.concepts < 0
      || stage.concepts > MAX_GRAPH_NODES
      || !Array.isArray(stage.labels) || stage.labels.length !== stage.concepts
      || stage.labels.some((label) => !validConceptLabel(label))
      || (stage.relations !== undefined && (!Number.isSafeInteger(stage.relations) || stage.relations < 0 || stage.relations > MAX_GRAPH_EDGES))) {
      throw new Error(`Learning-loop ${key} stage is invalid.`);
    }
  }
  const reviewed = stages.reviewed;
  assertOnlyKeys(reviewed, ["accepted", "rejected", "guidanceExamples"], "Learning-loop reviewed stage");
  assertOnlyKeys(reviewed?.accepted, ["id", "label", "status"], "Learning-loop accepted item");
  assertOnlyKeys(reviewed?.rejected, ["id", "label", "status"], "Learning-loop rejected item");
  if (!reviewed || typeof reviewed !== "object" || Array.isArray(reviewed)
    || !Number.isSafeInteger(reviewed.guidanceExamples) || reviewed.guidanceExamples < 0 || reviewed.guidanceExamples > MAX_FEEDBACK_EXAMPLES
    || !["accepted", "rejected"].includes(reviewed.accepted?.status)
    || !["accepted", "rejected"].includes(reviewed.rejected?.status)
    || !validId(reviewed.accepted?.id) || !validConceptLabel(reviewed.accepted?.label)
    || !validId(reviewed.rejected?.id) || !validConceptLabel(reviewed.rejected?.label)) {
    throw new Error("Learning-loop reviewed stage is invalid.");
  }
  if (!Number.isSafeInteger(stages.improved.relations) || stages.improved.relations < 0 || stages.improved.relations > MAX_GRAPH_EDGES) {
    throw new Error("Learning-loop improved relation count is invalid.");
  }
  const comparison = stages.comparison;
  assertOnlyKeys(comparison, ["baselineConcepts", "guidedConcepts", "conceptsRemovedByGuidance", "rejectedConceptPresentWithoutGuidance", "rejectedConceptPresentWithGuidance"], "Learning-loop comparison");
  if (!comparison || !Number.isSafeInteger(comparison.baselineConcepts) || !Number.isSafeInteger(comparison.guidedConcepts)
    || !Number.isSafeInteger(comparison.conceptsRemovedByGuidance)
    || comparison.baselineConcepts < 0 || comparison.baselineConcepts > MAX_GRAPH_NODES
    || comparison.guidedConcepts < 0 || comparison.guidedConcepts > MAX_GRAPH_NODES
    || comparison.conceptsRemovedByGuidance < 0 || comparison.conceptsRemovedByGuidance > MAX_GRAPH_NODES
    || typeof comparison.rejectedConceptPresentWithoutGuidance !== "boolean"
    || typeof comparison.rejectedConceptPresentWithGuidance !== "boolean") {
    throw new Error("Learning-loop comparison is invalid.");
  }
  if (comparison.conceptsRemovedByGuidance !== Math.max(0, comparison.baselineConcepts - comparison.guidedConcepts)) {
    throw new Error("Learning-loop comparison delta is inconsistent.");
  }
  const proof = value.proof;
  assertOnlyKeys(proof, ["acceptedConceptRetained", "rejectedConceptSuppressed", "reviewedGuidanceIsPortable"], "Learning-loop proof");
  if (!proof || typeof proof !== "object"
    || typeof proof.acceptedConceptRetained !== "boolean"
    || typeof proof.rejectedConceptSuppressed !== "boolean"
    || typeof proof.reviewedGuidanceIsPortable !== "boolean") {
    throw new Error("Learning-loop proof is invalid.");
  }
  if (proof.rejectedConceptSuppressed
    && (!comparison.rejectedConceptPresentWithoutGuidance
      || comparison.rejectedConceptPresentWithGuidance
      || comparison.conceptsRemovedByGuidance < 1)) {
    throw new Error("Learning-loop suppression proof is not grounded in its baseline comparison.");
  }
  return true;
}

export function runLearningLoop() {
  const initialExtraction = extractGraph("RAG loop", FIRST_DOCUMENT);
  const initialGraph = mergeExtraction(defaultGraph(), initialExtraction).graph;
  const accepted = applyFeedback(initialGraph, "node", "retrieval-loop", "up");
  if (!accepted.changed) throw new Error("The accepted review decision was not applied.");
  const rejected = applyFeedback(accepted.graph, "node", "loop", "down");
  if (!rejected.changed) throw new Error("The rejected review decision was not applied.");

  const guidance = buildExtractorFeedback(rejected.graph, { includeStale: false });
  const baselineExtraction = extractGraph("RAG loop follow-up", FOLLOW_UP_DOCUMENT);
  const improvedExtraction = extractGraph("RAG loop follow-up", FOLLOW_UP_DOCUMENT, { feedback: guidance });
  const acceptedNode = requireNode(rejected.graph, "retrieval-loop");
  const rejectedNode = requireNode(rejected.graph, "loop");
  const rejectedBaselinePresent = baselineExtraction.nodes.some((node) => node.id === "loop");
  const rejectedImprovedPresent = improvedExtraction.nodes.some((node) => node.id === "loop");

  const output = {
    format: "llm-field-notes/learning-loop@1",
    stages: {
      initial: {
        concepts: initialGraph.nodes.length,
        labels: labels(initialGraph)
      },
      reviewed: {
        accepted: { id: acceptedNode.id, label: acceptedNode.label, status: acceptedNode.status },
        rejected: { id: rejectedNode.id, label: rejectedNode.label, status: rejectedNode.status },
        guidanceExamples: guidance.length
      },
      improved: {
        concepts: improvedExtraction.nodes.length,
        labels: labels(improvedExtraction),
        relations: improvedExtraction.edges.length
      },
      comparison: {
        baselineConcepts: baselineExtraction.nodes.length,
        guidedConcepts: improvedExtraction.nodes.length,
        conceptsRemovedByGuidance: Math.max(0, baselineExtraction.nodes.length - improvedExtraction.nodes.length),
        rejectedConceptPresentWithoutGuidance: rejectedBaselinePresent,
        rejectedConceptPresentWithGuidance: rejectedImprovedPresent
      }
    },
    proof: {
      acceptedConceptRetained: improvedExtraction.nodes.some((node) => node.id === "retrieval-loop" && node.feedback === 0),
      rejectedConceptSuppressed: rejectedBaselinePresent && !rejectedImprovedPresent,
      reviewedGuidanceIsPortable: guidance.some((example) => example.id === "retrieval-loop" && example.status === "accepted")
    }
  };
  validateLearningLoopOutput(output);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runLearningLoop(), null, 2));
}
