import { GRAPH_SCHEMA, fingerprintFeedbackExamples, normalizeExtraction, slugify } from "./graph-core.js";

export const EVALUATION_SCHEMA = "llm-field-notes/evaluation@1";
export const MAX_EVALUATION_EXAMPLES = 15000;

const reviewedStatuses = new Set(["accepted", "rejected"]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value) {
  return slugify(asText(value));
}

function identity(value) {
  return asText(value);
}

function boundedExamples(value) {
  return Array.isArray(value) ? value.slice(0, MAX_EVALUATION_EXAMPLES) : [];
}

function feedbackIdentityKey(example) {
  if (example.kind === "concept") {
    return `concept|${identity(example.id) || normalized(example.label)}`;
  }
  const relationIdentity = identity(example.id)
    || `${normalized(example.source || example.sourceLabel)}|${normalized(example.target || example.targetLabel)}|${normalized(example.label)}`;
  return `relation|${relationIdentity}`;
}

function feedbackKey(example) {
  return `${feedbackIdentityKey(example)}|${example.status}`;
}

function conceptKeys(concept) {
  return new Set([
    identity(concept.id),
    normalized(concept.label),
    ...(Array.isArray(concept.aliases) ? concept.aliases.map(normalized) : [])
  ].filter(Boolean));
}

function relationEndpointMatches(actualId, expectedId, expectedLabel, nodeById) {
  if (identity(actualId) && identity(actualId) === identity(expectedId)) return true;
  const actualNode = nodeById.get(actualId);
  if (!actualNode) return false;
  return conceptKeys({
    id: actualId,
    label: actualNode.label,
    aliases: actualNode.aliases
  }).has(normalized(expectedLabel || expectedId));
}

function matchesConcept(example, node) {
  const expectedKeys = conceptKeys(example);
  return [...conceptKeys(node)].some((key) => expectedKeys.has(key));
}

function matchesRelation(example, edge, nodeById) {
  if (identity(example.id) && identity(example.id) === identity(edge.id)) return true;
  const labelMatches = normalized(example.label) === normalized(edge.label);
  const sourceMatches = relationEndpointMatches(edge.source, example.source, example.sourceLabel, nodeById);
  const targetMatches = relationEndpointMatches(edge.target, example.target, example.targetLabel, nodeById);
  return labelMatches && sourceMatches && targetMatches;
}

function metric(expected, found) {
  return {
    expected,
    found,
    missed: Math.max(0, expected - found),
    recall: expected ? Number((found / expected).toFixed(4)) : 1
  };
}

function countOneToOneMatches(examples, candidates, matcher) {
  const matchedCandidates = new Set();
  let found = 0;
  examples.forEach((example) => {
    const candidateIndex = candidates.findIndex((candidate, index) => (
      !matchedCandidates.has(index) && matcher(example, candidate)
    ));
    if (candidateIndex < 0) return;
    matchedCandidates.add(candidateIndex);
    found += 1;
  });
  return found;
}

function categoryMetric(examples, candidates, matcher) {
  const expected = examples.filter((example) => example.status === "accepted");
  const rejected = examples.filter((example) => example.status === "rejected");
  const foundAccepted = countOneToOneMatches(expected, candidates, matcher);
  const presentRejected = countOneToOneMatches(rejected, candidates, matcher);
  return {
    accepted: metric(expected.length, foundAccepted),
    rejected: {
      expected: rejected.length,
      suppressed: rejected.length - presentRejected,
      present: presentRejected,
      suppressionRate: rejected.length ? Number(((rejected.length - presentRejected) / rejected.length).toFixed(4)) : 1
    }
  };
}

export function evaluateExtraction(extraction, feedback = []) {
  const normalizedExtraction = normalizeExtraction(extraction);
  const concepts = normalizedExtraction.nodes;
  const relations = normalizedExtraction.edges;
  const nodeById = new Map(concepts.map((node) => [node.id, node]));
  const seenFeedback = new Set();
  const reviewed = boundedExamples(feedback).filter((example) => {
    if (!example || typeof example !== "object" || !reviewedStatuses.has(example.status)) return false;
    const key = feedbackKey(example);
    if (seenFeedback.has(key)) return false;
    seenFeedback.add(key);
    return true;
  });
  const conceptExamples = reviewed.filter((example) => example.kind === "concept");
  const relationExamples = reviewed.filter((example) => example.kind === "relation");
  const feedbackStatuses = new Map();
  reviewed.forEach((example) => {
    const key = feedbackIdentityKey(example);
    const statuses = feedbackStatuses.get(key) || new Set();
    statuses.add(example.status);
    feedbackStatuses.set(key, statuses);
  });
  const conflicts = [...feedbackStatuses.values()].filter((statuses) => statuses.size > 1).length;
  const conceptMatch = (example) => concepts.some((node) => matchesConcept(example, node));
  const relationMatch = (example) => relations.some((edge) => matchesRelation(example, edge, nodeById));
  const conceptMetrics = categoryMetric(conceptExamples, concepts, conceptMatch);
  const relationMetrics = categoryMetric(relationExamples, relations, relationMatch);
  const accepted = conceptMetrics.accepted.found + relationMetrics.accepted.found;
  const expectedAccepted = conceptMetrics.accepted.expected + relationMetrics.accepted.expected;
  const rejectedPresent = conceptMetrics.rejected.present + relationMetrics.rejected.present;
  const expectedRejected = conceptMetrics.rejected.expected + relationMetrics.rejected.expected;
  return {
    schema: EVALUATION_SCHEMA,
    graphSchema: GRAPH_SCHEMA,
    evaluatedAt: new Date().toISOString(),
    extraction: {
      concepts: concepts.length,
      relations: relations.length
    },
    feedback: {
      examples: reviewed.length,
      datasetFingerprint: fingerprintFeedbackExamples(reviewed),
      conflicts,
      concepts: conceptMetrics,
      relations: relationMetrics
    },
    overall: {
      accepted: metric(expectedAccepted, accepted),
      rejected: {
        expected: expectedRejected,
        suppressed: expectedRejected - rejectedPresent,
        present: rejectedPresent,
        suppressionRate: expectedRejected ? Number(((expectedRejected - rejectedPresent) / expectedRejected).toFixed(4)) : 1
      }
    }
  };
}
