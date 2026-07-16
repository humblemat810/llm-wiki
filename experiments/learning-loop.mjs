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
const RELATION_FOLLOW_UP_DOCUMENT = "The loop gives model relevant context. The loop uses source citations.";

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
  assertOnlyKeys(reviewed, ["accepted", "rejected", "acceptedRelation", "rejectedRelation", "guidanceExamples"], "Learning-loop reviewed stage");
  assertOnlyKeys(reviewed?.accepted, ["id", "label", "status"], "Learning-loop accepted item");
  assertOnlyKeys(reviewed?.rejected, ["id", "label", "status"], "Learning-loop rejected item");
  assertOnlyKeys(reviewed?.acceptedRelation, ["id", "label", "status"], "Learning-loop accepted relation");
  assertOnlyKeys(reviewed?.rejectedRelation, ["id", "label", "status"], "Learning-loop rejected relation");
  if (!reviewed || typeof reviewed !== "object" || Array.isArray(reviewed)
    || !Number.isSafeInteger(reviewed.guidanceExamples) || reviewed.guidanceExamples < 0 || reviewed.guidanceExamples > MAX_FEEDBACK_EXAMPLES
    || !["accepted", "rejected"].includes(reviewed.accepted?.status)
    || !["accepted", "rejected"].includes(reviewed.rejected?.status)
    || !["accepted", "rejected"].includes(reviewed.acceptedRelation?.status)
    || !["accepted", "rejected"].includes(reviewed.rejectedRelation?.status)
    || !validId(reviewed.accepted?.id) || !validConceptLabel(reviewed.accepted?.label)
    || !validId(reviewed.rejected?.id) || !validConceptLabel(reviewed.rejected?.label)
    || !validId(reviewed.acceptedRelation?.id) || !validConceptLabel(reviewed.acceptedRelation?.label)
    || !validId(reviewed.rejectedRelation?.id) || !validConceptLabel(reviewed.rejectedRelation?.label)) {
    throw new Error("Learning-loop reviewed stage is invalid.");
  }
  if (!Number.isSafeInteger(stages.improved.relations) || stages.improved.relations < 0 || stages.improved.relations > MAX_GRAPH_EDGES) {
    throw new Error("Learning-loop improved relation count is invalid.");
  }
  const comparison = stages.comparison;
  assertOnlyKeys(comparison, ["baselineConcepts", "guidedConcepts", "conceptsRemovedByGuidance", "rejectedConceptPresentWithoutGuidance", "rejectedConceptPresentWithGuidance", "baselineRelations", "guidedRelations", "relationsRemovedByGuidance", "rejectedRelationPresentWithoutGuidance", "rejectedRelationPresentWithGuidance"], "Learning-loop comparison");
  if (!comparison || !Number.isSafeInteger(comparison.baselineConcepts) || !Number.isSafeInteger(comparison.guidedConcepts)
    || !Number.isSafeInteger(comparison.conceptsRemovedByGuidance)
    || comparison.baselineConcepts < 0 || comparison.baselineConcepts > MAX_GRAPH_NODES
    || comparison.guidedConcepts < 0 || comparison.guidedConcepts > MAX_GRAPH_NODES
    || comparison.conceptsRemovedByGuidance < 0 || comparison.conceptsRemovedByGuidance > MAX_GRAPH_NODES
    || typeof comparison.rejectedConceptPresentWithoutGuidance !== "boolean"
    || typeof comparison.rejectedConceptPresentWithGuidance !== "boolean"
    || !Number.isSafeInteger(comparison.baselineRelations) || !Number.isSafeInteger(comparison.guidedRelations)
    || !Number.isSafeInteger(comparison.relationsRemovedByGuidance)
    || comparison.baselineRelations < 0 || comparison.baselineRelations > MAX_GRAPH_EDGES
    || comparison.guidedRelations < 0 || comparison.guidedRelations > MAX_GRAPH_EDGES
    || comparison.relationsRemovedByGuidance < 0 || comparison.relationsRemovedByGuidance > MAX_GRAPH_EDGES
    || typeof comparison.rejectedRelationPresentWithoutGuidance !== "boolean"
    || typeof comparison.rejectedRelationPresentWithGuidance !== "boolean") {
    throw new Error("Learning-loop comparison is invalid.");
  }
  if (comparison.conceptsRemovedByGuidance !== Math.max(0, comparison.baselineConcepts - comparison.guidedConcepts)) {
    throw new Error("Learning-loop comparison delta is inconsistent.");
  }
  if (comparison.relationsRemovedByGuidance !== Math.max(0, comparison.baselineRelations - comparison.guidedRelations)) {
    throw new Error("Learning-loop relation comparison delta is inconsistent.");
  }
  const proof = value.proof;
  assertOnlyKeys(proof, ["acceptedConceptRetained", "rejectedConceptSuppressed", "acceptedRelationRetained", "rejectedRelationSuppressed", "reviewedGuidanceIsPortable"], "Learning-loop proof");
  if (!proof || typeof proof !== "object"
    || typeof proof.acceptedConceptRetained !== "boolean"
    || typeof proof.rejectedConceptSuppressed !== "boolean"
    || typeof proof.acceptedRelationRetained !== "boolean"
    || typeof proof.rejectedRelationSuppressed !== "boolean"
    || typeof proof.reviewedGuidanceIsPortable !== "boolean") {
    throw new Error("Learning-loop proof is invalid.");
  }
  if (proof.rejectedConceptSuppressed
    && (!comparison.rejectedConceptPresentWithoutGuidance
      || comparison.rejectedConceptPresentWithGuidance
      || comparison.conceptsRemovedByGuidance < 1)) {
    throw new Error("Learning-loop suppression proof is not grounded in its baseline comparison.");
  }
  if (proof.rejectedRelationSuppressed
    && (!comparison.rejectedRelationPresentWithoutGuidance
      || comparison.rejectedRelationPresentWithGuidance
      || comparison.relationsRemovedByGuidance < 1)) {
    throw new Error("Learning-loop relation suppression proof is not grounded in its baseline comparison.");
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
  const acceptedRelation = applyFeedback(rejected.graph, "edge", "loop--source-citations--uses", "up");
  if (!acceptedRelation.changed) throw new Error("The accepted relation review decision was not applied.");
  const rejectedRelation = applyFeedback(acceptedRelation.graph, "edge", "loop--model-relevant--gives", "down");
  if (!rejectedRelation.changed) throw new Error("The rejected relation review decision was not applied.");

  const guidance = buildExtractorFeedback(rejectedRelation.graph, { includeStale: false });
  const baselineExtraction = extractGraph("RAG loop follow-up", FOLLOW_UP_DOCUMENT);
  const improvedExtraction = extractGraph("RAG loop follow-up", FOLLOW_UP_DOCUMENT, { feedback: guidance });
  const relationGuidance = guidance.filter((example) => example.kind === "relation");
  const relationBaseline = extractGraph("RAG relation follow-up", RELATION_FOLLOW_UP_DOCUMENT);
  const relationImproved = extractGraph("RAG relation follow-up", RELATION_FOLLOW_UP_DOCUMENT, { feedback: relationGuidance });
  const acceptedNode = requireNode(rejectedRelation.graph, "retrieval-loop");
  const rejectedNode = requireNode(rejectedRelation.graph, "loop");
  const rejectedBaselinePresent = baselineExtraction.nodes.some((node) => node.id === "loop");
  const rejectedImprovedPresent = improvedExtraction.nodes.some((node) => node.id === "loop");
  const acceptedRelationPresent = relationImproved.edges.some((edge) => edge.id === "loop--source-citations--uses");
  const rejectedRelationBaselinePresent = relationBaseline.edges.some((edge) => edge.id === "loop--model-relevant--gives");
  const rejectedRelationImprovedPresent = relationImproved.edges.some((edge) => edge.id === "loop--model-relevant--gives");

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
        acceptedRelation: { id: "loop--source-citations--uses", label: "uses", status: "accepted" },
        rejectedRelation: { id: "loop--model-relevant--gives", label: "gives", status: "rejected" },
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
        rejectedConceptPresentWithGuidance: rejectedImprovedPresent,
        baselineRelations: relationBaseline.edges.length,
        guidedRelations: relationImproved.edges.length,
        relationsRemovedByGuidance: Math.max(0, relationBaseline.edges.length - relationImproved.edges.length),
        rejectedRelationPresentWithoutGuidance: rejectedRelationBaselinePresent,
        rejectedRelationPresentWithGuidance: rejectedRelationImprovedPresent
      }
    },
    proof: {
      acceptedConceptRetained: improvedExtraction.nodes.some((node) => node.id === "retrieval-loop" && node.feedback === 0),
      rejectedConceptSuppressed: rejectedBaselinePresent && !rejectedImprovedPresent,
      acceptedRelationRetained: acceptedRelationPresent,
      rejectedRelationSuppressed: rejectedRelationBaselinePresent && !rejectedRelationImprovedPresent,
      reviewedGuidanceIsPortable: guidance.some((example) => example.id === "retrieval-loop" && example.status === "accepted")
        && guidance.some((example) => example.id === "loop--source-citations--uses" && example.status === "accepted")
    }
  };
  validateLearningLoopOutput(output);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runLearningLoop(), null, 2));
}
