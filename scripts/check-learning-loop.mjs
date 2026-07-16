import assert from "node:assert/strict";
import { runLearningLoop } from "../experiments/learning-loop.mjs";

const result = runLearningLoop();
assert.equal(result.proof.acceptedConceptRetained, true, "learning promotion requires accepted concepts to remain usable");
assert.equal(result.proof.rejectedConceptSuppressed, true, "learning promotion requires rejected concepts to be suppressed");
assert.equal(result.proof.acceptedRelationRetained, true, "learning promotion requires accepted relations to remain usable");
assert.equal(result.proof.rejectedRelationSuppressed, true, "learning promotion requires rejected relations to be suppressed");
assert.equal(result.proof.reviewedGuidanceIsPortable, true, "learning promotion requires reviewed guidance to remain portable");
assert.equal(result.stages.comparison.rejectedConceptPresentWithoutGuidance, true, "learning promotion requires a baseline rejection case");
assert.equal(result.stages.comparison.rejectedConceptPresentWithGuidance, false, "learning promotion requires guided suppression");
assert(result.stages.comparison.conceptsRemovedByGuidance > 0, "learning promotion requires a measurable guidance delta");
assert(result.stages.comparison.relationsRemovedByGuidance > 0, "learning promotion requires a measurable relation guidance delta");

console.log(JSON.stringify({
  checked: true,
  format: result.format,
  baselineConcepts: result.stages.comparison.baselineConcepts,
  guidedConcepts: result.stages.comparison.guidedConcepts,
  conceptsRemovedByGuidance: result.stages.comparison.conceptsRemovedByGuidance,
  acceptedConceptRetained: result.proof.acceptedConceptRetained,
  rejectedConceptSuppressed: result.proof.rejectedConceptSuppressed,
  acceptedRelationRetained: result.proof.acceptedRelationRetained,
  rejectedRelationSuppressed: result.proof.rejectedRelationSuppressed,
  reviewedGuidanceIsPortable: result.proof.reviewedGuidanceIsPortable
}, null, 2));
