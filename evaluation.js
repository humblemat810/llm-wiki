import { GRAPH_SCHEMA, MAX_ID_CHARS, MAX_RELATION_LABEL_CHARS, REVIEW_STALE_DAYS, fingerprintFeedbackExamples, normalizeExtraction, slugify } from "./graph-core.js";

export const EVALUATION_SCHEMA = "llm-field-notes/evaluation@1";
export const MAX_EVALUATION_EXAMPLES = 15000;

const reviewedStatuses = new Set(["accepted", "rejected"]);

function asText(value, limit = MAX_ID_CHARS) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function normalized(value, limit = MAX_ID_CHARS) {
  return slugify(asText(value, limit));
}

function identity(value) {
  return asText(value);
}

function boundedExamples(value) {
  return Array.isArray(value) ? value.slice(0, MAX_EVALUATION_EXAMPLES) : [];
}

function freshnessCounts(examples, now = Date.now()) {
  return examples.reduce((counts, example) => {
    const timestamp = typeof example.lastReviewedAt === "string"
      ? Date.parse(example.lastReviewedAt)
      : Number.NaN;
    if (Number.isNaN(timestamp)) {
      counts.undatedExamples += 1;
    } else if (now - timestamp >= REVIEW_STALE_DAYS * 86400000) {
      counts.staleExamples += 1;
    } else {
      counts.freshExamples += 1;
    }
    return counts;
  }, { freshExamples: 0, staleExamples: 0, undatedExamples: 0 });
}

function feedbackIdentityKey(example) {
  if (example.kind === "concept") {
    return `concept|${identity(example.id) || normalized(example.label)}`;
  }
  const source = normalized(example.sourceLabel || example.source);
  const target = normalized(example.targetLabel || example.target);
  const label = normalized(example.label);
  const forward = `${source}|${target}|${label}`;
  const reverse = `${target}|${source}|${label}`;
  const relationIdentity = source && target && label
    ? (forward < reverse ? forward : reverse)
    : identity(example.id) || forward;
  return `relation|${relationIdentity}`;
}

function feedbackKey(example) {
  return `${feedbackIdentityKey(example)}|${example.status}`;
}

function conceptKeys(concept) {
  const aliases = Array.isArray(concept.aliases) ? concept.aliases.slice(0, 20) : [];
  return new Set([
    identity(concept.id),
    normalized(concept.label, 120),
    ...aliases.map((alias) => normalized(alias, 120))
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
  const labelMatches = normalized(example.label) === normalized(edge.label);
  const forwardEndpointMatches = relationEndpointMatches(edge.source, example.source, example.sourceLabel, nodeById)
    && relationEndpointMatches(edge.target, example.target, example.targetLabel, nodeById);
  const reverseEndpointMatches = relationEndpointMatches(edge.source, example.target, example.targetLabel, nodeById)
    && relationEndpointMatches(edge.target, example.source, example.sourceLabel, nodeById);
  const endpointPairMatches = forwardEndpointMatches || reverseEndpointMatches;
  if (identity(example.id) && identity(example.id) === identity(edge.id)) {
    const hasDetailedIdentity = Boolean(
      identity(example.source)
      || identity(example.target)
      || identity(example.sourceLabel)
      || identity(example.targetLabel)
      || identity(example.label)
    );
    return !hasDetailedIdentity || (labelMatches && endpointPairMatches);
  }
  return labelMatches && endpointPairMatches;
}

function metric(expected, found) {
  return {
    expected,
    found,
    missed: Math.max(0, expected - found),
    recall: expected ? Number((found / expected).toFixed(4)) : 1
  };
}

function matchedOneToOneCandidates(examples, candidates, matcher) {
  const matchedCandidates = new Set();
  const matches = [];
  examples.forEach((example) => {
    const candidateIndex = candidates.findIndex((candidate, index) => (
      !matchedCandidates.has(index) && matcher(example, candidate)
    ));
    if (candidateIndex < 0) return;
    matchedCandidates.add(candidateIndex);
    matches.push(candidates[candidateIndex]);
  });
  return matches;
}

function evidenceBacked(candidate, sourceId) {
  return Array.isArray(candidate?.evidence)
    && candidate.evidence.some((evidence) => evidence?.text && evidence.sources?.includes(sourceId));
}

function categoryMetric(examples, candidates, matcher, acceptedMatcher = matcher, sourceId = "") {
  const expected = examples.filter((example) => example.status === "accepted");
  const rejected = examples.filter((example) => example.status === "rejected");
  const acceptedMatches = matchedOneToOneCandidates(expected, candidates, acceptedMatcher);
  const foundAccepted = acceptedMatches.length;
  const rejectedMatches = matchedOneToOneCandidates(rejected, candidates, matcher);
  const presentRejected = rejectedMatches.length;
  const acceptedMetric = metric(expected.length, foundAccepted);
  const reviewedCandidateMatches = new Set([...acceptedMatches, ...rejectedMatches]).size;
  acceptedMetric.reviewedPrecision = reviewedCandidateMatches
    ? Number((foundAccepted / reviewedCandidateMatches).toFixed(4))
    : 1;
  acceptedMetric.evidenceBacked = acceptedMatches.filter((candidate) => evidenceBacked(candidate, sourceId)).length;
  acceptedMetric.evidenceCoverage = expected.length
    ? Number((acceptedMetric.evidenceBacked / expected.length).toFixed(4))
    : 1;
  return {
    accepted: acceptedMetric,
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
  const freshness = freshnessCounts(reviewed);
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
  const conceptMatch = (example, node) => matchesConcept(example, node);
  const relationMatch = (example, edge) => matchesRelation(example, edge, nodeById);
  const sourceId = normalizedExtraction.source.id;
  const conceptMetrics = categoryMetric(
    conceptExamples,
    concepts,
    conceptMatch,
    (example, node) => node.status !== "rejected" && conceptMatch(example, node),
    sourceId
  );
  const relationMetrics = categoryMetric(
    relationExamples,
    relations,
    relationMatch,
    (example, edge) => edge.status !== "rejected" && relationMatch(example, edge),
    sourceId
  );
  const accepted = conceptMetrics.accepted.found + relationMetrics.accepted.found;
  const expectedAccepted = conceptMetrics.accepted.expected + relationMetrics.accepted.expected;
  const evidenceBackedAccepted = conceptMetrics.accepted.evidenceBacked + relationMetrics.accepted.evidenceBacked;
  const rejectedPresent = conceptMetrics.rejected.present + relationMetrics.rejected.present;
  const expectedRejected = conceptMetrics.rejected.expected + relationMetrics.rejected.expected;
  const overallAccepted = metric(expectedAccepted, accepted);
  const overallReviewedCandidateMatches = accepted + rejectedPresent;
  overallAccepted.reviewedPrecision = overallReviewedCandidateMatches
    ? Number((accepted / overallReviewedCandidateMatches).toFixed(4))
    : 1;
  overallAccepted.evidenceBacked = evidenceBackedAccepted;
  overallAccepted.evidenceCoverage = expectedAccepted
    ? Number((evidenceBackedAccepted / expectedAccepted).toFixed(4))
    : 1;
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
      ...freshness,
      untrustedExamples: freshness.staleExamples + freshness.undatedExamples,
      conflicts,
      concepts: conceptMetrics,
      relations: relationMetrics
    },
    overall: {
      accepted: overallAccepted,
      rejected: {
        expected: expectedRejected,
        suppressed: expectedRejected - rejectedPresent,
        present: rejectedPresent,
        suppressionRate: expectedRejected ? Number(((expectedRejected - rejectedPresent) / expectedRejected).toFixed(4)) : 1
      }
    }
  };
}
