import { GRAPH_SCHEMA, MAX_ALIASES, MAX_CONCEPT_LABEL_CHARS, MAX_EVIDENCE_CHARS, MAX_EVIDENCE_RECORDS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, MAX_ID_CHARS, MAX_RELATION_LABEL_CHARS, MAX_SOURCE_REFERENCES, MAX_TIMESTAMP_CHARS, REVIEW_STALE_DAYS, fingerprintFeedbackExamples, normalizeExtraction, parseTimestamp, sliceTextAtCodePointBoundary, slugify } from "./graph-core.js";

export const EVALUATION_SCHEMA = "llm-field-notes/evaluation@1";
export const MAX_EVALUATION_EXAMPLES = 15000;
export const MAX_EVALUATION_MATCH_COMPARISONS = 2000000;
export const MAX_EVALUATION_ID_CHARS = 4096;

const reviewedStatuses = new Set(["accepted", "rejected"]);
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function asText(value, limit = MAX_ID_CHARS) {
  return typeof value === "string" ? sliceTextAtCodePointBoundary(value.trim(), limit) : "";
}

function normalized(value, limit = MAX_ID_CHARS) {
  return slugify(asText(value, limit));
}

function identity(value) {
  return asText(value);
}

function boundedExamples(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_EVALUATION_EXAMPLES) {
    throw new Error(`Evaluation feedback exceeds the ${MAX_EVALUATION_EXAMPLES.toLocaleString("en-US")} example safety limit.`);
  }
  return value;
}

function assertReviewableExamples(examples) {
  examples.forEach((example, index) => {
    if (!example || typeof example !== "object" || Array.isArray(example)
      || !["concept", "relation"].includes(example.kind)
      || !reviewedStatuses.has(example.status)) {
      throw new Error(`Evaluation feedback example ${index} is not a reviewed concept or relation.`);
    }
    const path = `Evaluation feedback example ${index}`;
    const assertString = (field, maximum) => {
      if (example[field] === undefined || example[field] === null) return;
      if (typeof example[field] !== "string" || example[field].length > maximum) {
        throw new Error(`${path}.${field} must be a string no longer than ${maximum} characters.`);
      }
    };
    assertString("id", MAX_EVALUATION_ID_CHARS);
    assertString("label", example.kind === "relation" ? MAX_RELATION_LABEL_CHARS : MAX_CONCEPT_LABEL_CHARS);
    assertString("source", MAX_EVALUATION_ID_CHARS);
    assertString("target", MAX_EVALUATION_ID_CHARS);
    assertString("sourceLabel", MAX_CONCEPT_LABEL_CHARS);
    assertString("targetLabel", MAX_CONCEPT_LABEL_CHARS);
    if (example.aliases !== undefined && !Array.isArray(example.aliases)) {
      throw new Error(`${path}.aliases exceeds the bounded unique alias contract.`);
    }
    if (Array.isArray(example.aliases)) {
      if (example.aliases.length > MAX_ALIASES || new Set(example.aliases).size !== example.aliases.length) {
        throw new Error(`${path}.aliases exceeds the bounded unique alias contract.`);
      }
      const aliases = example.aliases;
      if (aliases.some((alias) => typeof alias !== "string" || alias.length > MAX_CONCEPT_LABEL_CHARS)) {
        throw new Error(`${path}.aliases exceeds the bounded unique alias contract.`);
      }
    }
    if (example.lastReviewedAt !== undefined && example.lastReviewedAt !== null
      && (typeof example.lastReviewedAt !== "string"
        || example.lastReviewedAt.length > MAX_TIMESTAMP_CHARS
        || Number.isNaN(parseTimestamp(example.lastReviewedAt)))) {
      throw new Error(`${path}.lastReviewedAt must be a valid bounded timestamp.`);
    }
    if (example.sources !== undefined && (
      !Array.isArray(example.sources)
      || example.sources.length > MAX_SOURCE_REFERENCES
      || example.sources.some((source) => typeof source !== "string" || source.length > MAX_ID_CHARS)
    )) {
      throw new Error(`${path}.sources exceeds the bounded provenance-reference contract.`);
    }
    if (example.evidence !== undefined && (
      !Array.isArray(example.evidence)
      || example.evidence.length > MAX_EVIDENCE_RECORDS
      || example.evidence.some((evidence) => !evidence || typeof evidence !== "object" || Array.isArray(evidence)
        || typeof evidence.text !== "string"
        || evidence.text.length > MAX_EVIDENCE_CHARS
        || !Array.isArray(evidence.sources)
        || evidence.sources.length > MAX_SOURCE_REFERENCES
        || evidence.sources.some((source) => typeof source !== "string" || source.length > MAX_ID_CHARS))
    )) {
      throw new Error(`${path}.evidence exceeds the bounded evidence contract.`);
    }
  });
}

function freshnessCounts(examples, now = Date.now()) {
  return examples.reduce((counts, example) => {
    const timestamp = typeof example.lastReviewedAt === "string"
      ? parseTimestamp(example.lastReviewedAt)
      : Number.NaN;
    if (Number.isNaN(timestamp) || timestamp > now) {
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
  const aliases = Array.isArray(concept.aliases) ? concept.aliases.slice(0, MAX_ALIASES) : [];
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

function assertSafeCount(value, path, maximum = MAX_EVALUATION_EXAMPLES) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${path} must be an integer from 0 to ${maximum}.`);
  }
}

function assertRatio(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a finite number between 0 and 1.`);
  }
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is not allowed.`);
  }
}

function assertRoundedRatio(value, numerator, denominator, path) {
  const expected = denominator ? numerator / denominator : 1;
  if (Math.abs(value - expected) > 0.0001) {
    throw new Error(`${path} is inconsistent with its counts.`);
  }
}

function validateAcceptedMetric(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} is missing.`);
  assertKnownKeys(value, new Set(["expected", "found", "missed", "recall", "reviewedPrecision", "evidenceBacked", "evidenceCoverage"]), path);
  for (const field of ["expected", "found", "missed"]) assertSafeCount(value[field], `${path}.${field}`);
  if (value.found > value.expected || value.missed !== value.expected - value.found) {
    throw new Error(`${path} has inconsistent expected, found, and missed counts.`);
  }
  assertRatio(value.recall, `${path}.recall`);
  assertRoundedRatio(value.recall, value.found, value.expected, `${path}.recall`);
  if (value.reviewedPrecision !== undefined) assertRatio(value.reviewedPrecision, `${path}.reviewedPrecision`);
  if (value.evidenceBacked !== undefined) {
    assertSafeCount(value.evidenceBacked, `${path}.evidenceBacked`);
    if (value.evidenceBacked > value.found) throw new Error(`${path}.evidenceBacked cannot exceed found.`);
  }
  if (value.evidenceCoverage !== undefined) {
    assertRatio(value.evidenceCoverage, `${path}.evidenceCoverage`);
    assertRoundedRatio(value.evidenceCoverage, value.evidenceBacked || 0, value.expected, `${path}.evidenceCoverage`);
  }
}

function validateRejectedMetric(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} is missing.`);
  assertKnownKeys(value, new Set(["expected", "suppressed", "present", "suppressionRate"]), path);
  for (const field of ["expected", "suppressed", "present"]) assertSafeCount(value[field], `${path}.${field}`);
  if (value.present > value.expected || value.suppressed !== value.expected - value.present) {
    throw new Error(`${path} has inconsistent expected, suppressed, and present counts.`);
  }
  assertRatio(value.suppressionRate, `${path}.suppressionRate`);
  assertRoundedRatio(value.suppressionRate, value.suppressed, value.expected, `${path}.suppressionRate`);
}

function validateCategory(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} is missing.`);
  assertKnownKeys(value, new Set(["accepted", "rejected"]), path);
  validateAcceptedMetric(value.accepted, `${path}.accepted`);
  validateRejectedMetric(value.rejected, `${path}.rejected`);
}

function validateCategoryAgainstExtraction(value, path, extractionCount) {
  const acceptedFound = value.accepted.found;
  const rejectedPresent = value.rejected.present;
  if (acceptedFound > extractionCount || rejectedPresent > extractionCount) {
    throw new Error(`${path} reports more matched candidates than the extraction contains.`);
  }
}

export function validateEvaluationReport(value, { label = "evaluation", allowEmpty = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  assertKnownKeys(value, new Set(["schema", "graphSchema", "evaluatedAt", "extraction", "feedback", "overall"]), label);
  if (value.schema !== EVALUATION_SCHEMA) throw new Error(`${label} must declare ${EVALUATION_SCHEMA}.`);
  if (value.graphSchema !== GRAPH_SCHEMA) throw new Error(`${label} must declare ${GRAPH_SCHEMA}.`);
  if (typeof value.evaluatedAt !== "string"
    || !value.evaluatedAt.trim()
    || value.evaluatedAt.length > MAX_TIMESTAMP_CHARS
    || !DATE_TIME_PATTERN.test(value.evaluatedAt)
    || Number.isNaN(parseTimestamp(value.evaluatedAt))
    || parseTimestamp(value.evaluatedAt) > Date.now()) {
    throw new Error(`${label}.evaluatedAt must be a valid bounded date-time.`);
  }
  if (!value.extraction || typeof value.extraction !== "object" || Array.isArray(value.extraction)) throw new Error(`${label}.extraction is missing.`);
  assertKnownKeys(value.extraction, new Set(["concepts", "relations"]), `${label}.extraction`);
  assertSafeCount(value.extraction.concepts, `${label}.extraction.concepts`, 5000);
  assertSafeCount(value.extraction.relations, `${label}.extraction.relations`, 10000);
  const feedback = value.feedback;
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) throw new Error(`${label}.feedback is missing.`);
  assertKnownKeys(feedback, new Set(["examples", "datasetFingerprint", "freshExamples", "staleExamples", "undatedExamples", "untrustedExamples", "conflicts", "concepts", "relations"]), `${label}.feedback`);
  assertSafeCount(feedback.examples, `${label}.feedback.examples`);
  if (!allowEmpty && feedback.examples < 1) throw new Error(`${label} must contain at least one reviewed example.`);
  if (typeof feedback.datasetFingerprint !== "string" || !/^fnv1a-[0-9a-f]{8}(?:[0-9a-f]{8})?$/.test(feedback.datasetFingerprint)) {
    throw new Error(`${label}.feedback.datasetFingerprint is invalid.`);
  }
  assertSafeCount(feedback.conflicts, `${label}.feedback.conflicts`);
  if (feedback.conflicts > feedback.examples) throw new Error(`${label}.feedback.conflicts cannot exceed examples.`);
  const freshnessFields = ["freshExamples", "staleExamples", "undatedExamples", "untrustedExamples"];
  const freshnessPresent = freshnessFields.map((field) => Object.hasOwn(feedback, field));
  if (freshnessPresent.some(Boolean) && !freshnessPresent.every(Boolean)) {
    throw new Error(`${label}.feedback freshness diagnostics are incomplete.`);
  }
  if (freshnessPresent.every(Boolean)) {
    freshnessFields.slice(0, 3).forEach((field) => assertSafeCount(feedback[field], `${label}.feedback.${field}`));
    assertSafeCount(feedback.untrustedExamples, `${label}.feedback.untrustedExamples`);
    if (feedback.freshExamples + feedback.staleExamples + feedback.undatedExamples !== feedback.examples
      || feedback.untrustedExamples !== feedback.staleExamples + feedback.undatedExamples) {
      throw new Error(`${label}.feedback freshness diagnostics are inconsistent.`);
    }
  }
  validateCategory(feedback.concepts, `${label}.feedback.concepts`);
  validateCategory(feedback.relations, `${label}.feedback.relations`);
  validateCategoryAgainstExtraction(feedback.concepts, `${label}.feedback.concepts`, value.extraction.concepts);
  validateCategoryAgainstExtraction(feedback.relations, `${label}.feedback.relations`, value.extraction.relations);
  if (!value.overall || typeof value.overall !== "object" || Array.isArray(value.overall)) throw new Error(`${label}.overall is missing.`);
  assertKnownKeys(value.overall, new Set(["accepted", "rejected"]), `${label}.overall`);
  validateAcceptedMetric(value.overall.accepted, `${label}.overall.accepted`);
  validateRejectedMetric(value.overall.rejected, `${label}.overall.rejected`);
  const acceptedExpected = feedback.concepts.accepted.expected + feedback.relations.accepted.expected;
  const acceptedFound = feedback.concepts.accepted.found + feedback.relations.accepted.found;
  const acceptedMissed = feedback.concepts.accepted.missed + feedback.relations.accepted.missed;
  const rejectedExpected = feedback.concepts.rejected.expected + feedback.relations.rejected.expected;
  const rejectedPresent = feedback.concepts.rejected.present + feedback.relations.rejected.present;
  const rejectedSuppressed = feedback.concepts.rejected.suppressed + feedback.relations.rejected.suppressed;
  if (acceptedExpected + rejectedExpected !== feedback.examples) {
    throw new Error(`${label}.feedback category counts do not match the reviewed-example count.`);
  }
  if (value.overall.accepted.expected !== acceptedExpected
    || value.overall.accepted.found !== acceptedFound
    || value.overall.accepted.missed !== acceptedMissed
    || value.overall.rejected.expected !== rejectedExpected
    || value.overall.rejected.present !== rejectedPresent
    || value.overall.rejected.suppressed !== rejectedSuppressed) {
    throw new Error(`${label} overall metrics do not match category metrics.`);
  }
  return value;
}

function stableMatchKey(value) {
  return [
    value?.kind || "",
    value?.id || "",
    value?.source || "",
    value?.target || "",
    value?.sourceLabel || "",
    value?.targetLabel || "",
    value?.label || "",
    ...(Array.isArray(value?.aliases) ? value.aliases.slice(0, MAX_ALIASES).map(String).sort() : [])
  ].join("\u0000");
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchedOneToOneCandidates(examples, candidates, matcher) {
  if (examples.length * candidates.length > MAX_EVALUATION_MATCH_COMPARISONS) {
    throw new Error(`Evaluation matching exceeds the ${MAX_EVALUATION_MATCH_COMPARISONS.toLocaleString("en-US")} comparison safety limit.`);
  }
  const options = examples.map((example, exampleIndex) => ({
    exampleIndex,
    candidateIndexes: candidates
      .map((candidate, candidateIndex) => matcher(example, candidate) ? candidateIndex : -1)
      .filter((candidateIndex) => candidateIndex >= 0)
      .sort((left, right) => (
        lexicalCompare(stableMatchKey(candidates[left]), stableMatchKey(candidates[right]))
        || left - right
      ))
  }));
  const ordered = options.sort((left, right) => (
    left.candidateIndexes.length - right.candidateIndexes.length
    || lexicalCompare(stableMatchKey(examples[left.exampleIndex]), stableMatchKey(examples[right.exampleIndex]))
    || left.exampleIndex - right.exampleIndex
  ));
  const optionsByExample = new Map(options.map((option) => [option.exampleIndex, option.candidateIndexes]));
  const candidateOwners = new Map();
  ordered.forEach(({ exampleIndex }) => {
    const queue = [exampleIndex];
    let queueIndex = 0;
    const visitedExamples = new Set([exampleIndex]);
    const visitedCandidates = new Set();
    const parentExamples = new Map();
    const parentCandidates = new Map();
    let freeCandidate;
    let currentExample;
    while (queueIndex < queue.length && freeCandidate === undefined) {
      currentExample = queue[queueIndex++];
      const currentOptions = optionsByExample.get(currentExample) || [];
      for (const candidateIndex of currentOptions) {
        if (visitedCandidates.has(candidateIndex)) continue;
        visitedCandidates.add(candidateIndex);
        const owner = candidateOwners.get(candidateIndex);
        if (owner === undefined) {
          freeCandidate = candidateIndex;
          break;
        }
        if (visitedExamples.has(owner)) continue;
        visitedExamples.add(owner);
        parentExamples.set(owner, currentExample);
        parentCandidates.set(owner, candidateIndex);
        queue.push(owner);
      }
    }
    if (freeCandidate === undefined) return;
    let assignedExample = currentExample;
    candidateOwners.set(freeCandidate, assignedExample);
    while (assignedExample !== exampleIndex) {
      const parentExample = parentExamples.get(assignedExample);
      const parentCandidate = parentCandidates.get(assignedExample);
      candidateOwners.set(parentCandidate, parentExample);
      assignedExample = parentExample;
    }
  });
  const matches = new Map([...candidateOwners.entries()].map(([candidateIndex, exampleIndex]) => [
    exampleIndex,
    candidates[candidateIndex]
  ]));
  return examples.map((_, exampleIndex) => matches.get(exampleIndex)).filter(Boolean);
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

export function evaluateExtraction(extraction, feedback = [], { now = Date.now() } = {}) {
  if (Array.isArray(extraction?.nodes) && extraction.nodes.length > MAX_GRAPH_NODES) {
    throw new Error(`Evaluation extraction exceeds the ${MAX_GRAPH_NODES.toLocaleString("en-US")} concept safety limit.`);
  }
  if (Array.isArray(extraction?.edges) && extraction.edges.length > MAX_GRAPH_EDGES) {
    throw new Error(`Evaluation extraction exceeds the ${MAX_GRAPH_EDGES.toLocaleString("en-US")} relation safety limit.`);
  }
  const normalizedExtraction = normalizeExtraction(extraction);
  const concepts = normalizedExtraction.nodes;
  const relations = normalizedExtraction.edges;
  const nodeById = new Map(concepts.map((node) => [node.id, node]));
  const seenFeedback = new Set();
  const examples = boundedExamples(feedback);
  assertReviewableExamples(examples);
  const reviewed = examples.filter((example) => {
    const key = feedbackKey(example);
    if (seenFeedback.has(key)) return false;
    seenFeedback.add(key);
    return true;
  });
  const evaluationNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const freshness = freshnessCounts(reviewed, evaluationNow);
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
