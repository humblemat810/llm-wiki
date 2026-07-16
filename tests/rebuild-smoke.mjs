import assert from "node:assert/strict";
import { applyFeedback, buildExtractorFeedback, defaultGraph, extractGraph, mergeExtraction, replaceSource } from "../graph-core.js";
import { MAX_REBUILD_FAILURE_CHARS, rebuildSources } from "../rebuild-adapter.js";

const sourceText = (topic) => `${topic} uses a bounded representation with evidence and review feedback. The graph keeps the source attached so later learning can improve the internal map.`;
let graph = defaultGraph();
graph = mergeExtraction(graph, extractGraph("Attention", sourceText("Attention"))).graph;
graph = mergeExtraction(graph, extractGraph("Retrieval", sourceText("Retrieval"))).graph;
const originalIds = graph.documents.map((document) => document.id);
const progress = [];
const rebuilt = await rebuildSources(graph, {
  revisionExtractor: "local",
  onProgress: ({ sourceIndex, total, source }) => progress.push(`${sourceIndex + 1}/${total}:${source.title}`),
  extract: (source) => extractGraph(source.title, `${source.text} Review improves the representation over time.`)
});
assert.equal(rebuilt.rebuilt, 2, "saved-source rebuild should replace every valid source");
assert.equal(rebuilt.failures.length, 0, "valid saved-source rebuild should not report failures");
assert.equal(rebuilt.canceled, false, "completed saved-source rebuild should not be marked canceled");
assert.equal(rebuilt.rebuildDetails.length, 2, "saved-source rebuild should return one bounded detail record per successful replacement");
assert(rebuilt.rebuildDetails.every((detail) => detail.sourceId
  && detail.title
  && [detail.beforeNodes, detail.afterNodes, detail.beforeEdges, detail.afterEdges, detail.removedNodes, detail.removedEdges]
    .every((count) => Number.isSafeInteger(count) && count >= 0)), "rebuild detail records should expose bounded source contribution and pruning counts");
assert.deepEqual(progress, ["1/2:Attention", "2/2:Retrieval"], "saved-source rebuild should report bounded progress in source order");
assert.deepEqual(rebuilt.graph.documents.map((document) => document.id), originalIds, "saved-source rebuild should preserve stable source identities");
assert(rebuilt.graph.revisions.slice(0, 2).every((revision) => revision.operation === "rebuild" && revision.extractor === "local"), "saved-source rebuild should preserve bounded extractor provenance in each replacement revision");

const reviewedNode = graph.nodes[0];
const reviewedNodeSourceId = reviewedNode.sources[0];
const reviewedNodeSourceTitle = graph.documents.find((document) => document.id === reviewedNodeSourceId)?.title;
const reviewedGraph = applyFeedback(graph, "node", reviewedNode.id, "up").graph;
const reviewedRebuild = await rebuildSources(reviewedGraph, {
  extract: (source) => extractGraph(source.title, `${source.text} Reviewed decisions must survive rebuilds.`),
  replace: (currentGraph, sourceId, extraction, options) => sourceId === reviewedNodeSourceId
    ? {
      replaced: true,
      graph: {
        ...currentGraph,
        nodes: currentGraph.nodes.filter((node) => node.id !== reviewedNode.id),
        edges: currentGraph.edges.filter((edge) => edge.source !== reviewedNode.id && edge.target !== reviewedNode.id)
      }
    }
    : replaceSource(currentGraph, sourceId, extraction, options)
});
assert.equal(reviewedRebuild.rebuilt, 1, "rebuild should retain valid replacements while rejecting the reviewed-decision loss");
assert.equal(reviewedRebuild.failures.find((failure) => failure.endsWith("replacement removed or changed a reviewed decision")), `${reviewedNodeSourceTitle}: replacement removed or changed a reviewed decision`, "rebuilds should report reviewed concept loss instead of persisting it");

const rejectedNode = graph.nodes.find((node) => node.status === "inferred");
const rejectedGraph = applyFeedback(graph, "node", rejectedNode.id, "down").graph;
const rejectedFeedback = buildExtractorFeedback(rejectedGraph);
const suppressedRejectedDecisions = new Set(rejectedFeedback
  .filter((example) => example.status === "rejected")
  .map((example) => `${example.kind === "concept" ? "node" : "edge"}|${example.id}`));
const suppressionRebuild = await rebuildSources(rejectedGraph, {
  suppressedRejectedDecisions,
  extract: (source) => extractGraph(source.title, source.text, { feedback: rejectedFeedback })
});
assert.equal(suppressionRebuild.rebuilt, 2, "feedback-guided rebuilds should persist successful source replacements when rejected concepts are intentionally suppressed");
assert.equal(suppressionRebuild.failures.length, 0, "intentional rejected-item suppression should not be reported as accidental reviewed-decision loss");
assert(!suppressionRebuild.graph.nodes.some((node) => node.id === rejectedNode.id), "feedback-guided rebuilds should remove a rejected concept that the extractor intentionally suppresses");
assert(suppressionRebuild.graph.learning.examples.some((example) => example.kind === "concept" && example.id === rejectedNode.id && example.status === "rejected"), "suppressed rejected concepts should remain reusable learning memory after rebuild");

const rejectedEdge = graph.edges[0];
const rejectedRelationGraph = applyFeedback(graph, "edge", rejectedEdge.id, "down").graph;
const rejectedRelationFeedback = buildExtractorFeedback(rejectedRelationGraph);
const suppressedRejectedRelations = new Set(rejectedRelationFeedback
  .filter((example) => example.status === "rejected")
  .map((example) => `${example.kind === "concept" ? "node" : "edge"}|${example.id}`));
const relationSuppressionRebuild = await rebuildSources(rejectedRelationGraph, {
  suppressedRejectedDecisions: suppressedRejectedRelations,
  extract: (source) => extractGraph(source.title, source.text, { feedback: rejectedRelationFeedback })
});
assert.equal(relationSuppressionRebuild.rebuilt, 2, "feedback-guided rebuilds should also persist intentional rejected-relation suppression");
assert(!relationSuppressionRebuild.graph.edges.some((edge) => edge.id === rejectedEdge.id), "feedback-guided rebuilds should remove a rejected relation that the extractor intentionally suppresses");
assert(relationSuppressionRebuild.graph.learning.examples.some((example) => example.kind === "relation" && example.id === rejectedEdge.id && example.status === "rejected"), "suppressed rejected relations should remain reusable learning memory after rebuild");

const failure = await rebuildSources(graph, {
  extract: (source) => {
    if (source.title === "Retrieval") throw new Error("provider unavailable");
    return extractGraph(source.title, `${source.text} New evidence arrived.`);
  }
});
assert.equal(failure.rebuilt, 1, "saved-source rebuild should retain successful replacements before a later failure");
assert.deepEqual(failure.failures, ["Retrieval: provider unavailable"], "saved-source rebuild should preserve bounded provider diagnostics");

const oversizedFailure = await rebuildSources(graph, {
  extract: (source) => {
    if (source.title === "Attention") throw new Error(`bad\nprovider ${"x".repeat(1000)}`);
    return extractGraph(source.title, source.text);
  }
});
assert.equal(oversizedFailure.failures[0].length, "Attention: ".length + MAX_REBUILD_FAILURE_CHARS, "saved-source rebuild diagnostics should be bounded");
assert(!/[\u0000-\u001f\u007f]/.test(oversizedFailure.failures[0]), "saved-source rebuild diagnostics should remove control characters");

const progressFailure = await rebuildSources(graph, {
  onProgress: () => {
    throw new Error("progress surface unavailable");
  },
  extract: (source) => extractGraph(source.title, `${source.text} Progress reporting is optional.`)
});
assert.equal(progressFailure.rebuilt, 2, "progress callback failures must not abort saved-source rebuilding");

const controller = new AbortController();
controller.abort();
const canceled = await rebuildSources(graph, {
  signal: controller.signal,
  extract: () => {
    throw new Error("extractor should not run after cancellation");
  }
});
assert.equal(canceled.rebuilt, 0, "canceled saved-source rebuild should not mutate sources");
assert.equal(canceled.canceled, true, "pre-canceled saved-source rebuild should report cancellation");

const callbackController = new AbortController();
let callbackExtracted = false;
const callbackCanceled = await rebuildSources(graph, {
  signal: callbackController.signal,
  onProgress: () => callbackController.abort(),
  extract: () => {
    callbackExtracted = true;
    return extractGraph("unexpected", sourceText("unexpected"));
  }
});
assert.equal(callbackExtracted, false, "cancellation raised by progress reporting must stop before extraction");
assert.equal(callbackCanceled.canceled, true, "progress-triggered cancellation should be reported");

const hangingController = new AbortController();
const hangingExtraction = await rebuildSources(graph, {
  signal: hangingController.signal,
  extract: () => {
    hangingController.abort();
    return new Promise(() => {});
  }
});
assert.equal(hangingExtraction.rebuilt, 0, "cancellation should not count an extractor that never settles");
assert.equal(hangingExtraction.canceled, true, "rebuild cancellation should return promptly when an extractor ignores the abort signal");

await assert.rejects(
  () => rebuildSources({ documents: Array(1001).fill({ id: "source", title: "source" }) }, { extract: () => null }),
  /Saved source count exceeds the 1000 document safety limit/,
  "saved-source rebuild should reject an over-capacity source collection before orchestration"
);
await assert.rejects(
  () => rebuildSources({ documents: [{ id: "", title: "Broken", text: "source" }] }, { extract: () => null }),
  /Saved source records must contain bounded IDs, titles, and text/,
  "saved-source rebuild should reject malformed source records before orchestration"
);
const invalidReplacement = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Invalid replacement test.`),
  replace: () => ({ replaced: true, graph: null })
});
assert.equal(invalidReplacement.rebuilt, 0, "invalid replacement results must not be counted as rebuilt");
assert.equal(invalidReplacement.failures[0], "Attention: replacement returned an invalid graph", "invalid replacement results should become bounded failures");
const originalFirstSourceText = graph.documents[0].text;
const mutatingReplacement = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Mutation isolation test.`),
  replace: (currentGraph) => {
    currentGraph.documents[0].text = "provider mutated the replacement input";
    return { replaced: true, graph: null };
  }
});
assert.equal(mutatingReplacement.rebuilt, 0, "mutating invalid replacement results must not be counted as rebuilt");
assert.equal(mutatingReplacement.failures[0], "Attention: replacement returned an invalid graph", "mutating invalid replacements should remain bounded failures");
assert.equal(graph.documents[0].text, originalFirstSourceText, "replacement implementations must not mutate the committed graph snapshot");
const originalSecondSourceText = graph.documents[1].text;
const mutatingExtractor = await rebuildSources(graph, {
  extract: (source, currentGraph) => {
    currentGraph.documents[1].text = "extractor mutated the graph context";
    return extractGraph(source.title, `${source.text} Extractor isolation test.`);
  }
});
assert.equal(mutatingExtractor.rebuilt, 2, "extractors that mutate only their snapshot should still produce valid rebuilds");
assert.equal(graph.documents[1].text, originalSecondSourceText, "extractors must not mutate the committed graph context");
const sourceDroppingReplacement = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Source identity test.`),
  replace: () => ({ replaced: true, graph: { ...defaultGraph(), documents: [] } })
});
assert.equal(sourceDroppingReplacement.rebuilt, 0, "source-dropping replacement results must not be counted as rebuilt");
assert.equal(sourceDroppingReplacement.failures[0], "Attention: replacement returned an invalid graph", "source-dropping replacement results should become bounded failures");
const silentlyDroppingReplacement = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Malformed replacement test.`),
  replace: (currentGraph, sourceId) => ({
    replaced: true,
    graph: {
      ...currentGraph,
      nodes: [...currentGraph.nodes, { label: "missing stable identity" }]
    }
  })
});
assert.equal(silentlyDroppingReplacement.rebuilt, 0, "rebuild should reject replacements that normalization would silently drop");
assert.equal(silentlyDroppingReplacement.failures[0], "Attention: replacement returned an invalid graph", "rebuild should report normalization data loss instead of accepting a partial replacement");
const ambiguousReplacement = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Ambiguous replacement test.`),
  replace: (currentGraph) => ({
    replaced: true,
    graph: {
      ...currentGraph,
      integrity: { ...currentGraph.integrity, ambiguousEdgeIds: ["ambiguous-edge"] }
    }
  })
});
assert.equal(ambiguousReplacement.rebuilt, 0, "rebuild should reject replacements carrying ambiguous identity diagnostics");
assert.equal(ambiguousReplacement.failures[0], "Attention: replacement returned an ambiguous graph", "rebuild should expose ambiguous replacement diagnostics instead of persisting them");
const unrelatedSourceMutation = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Unrelated source mutation test.`),
  replace: (currentGraph, sourceId) => ({
    replaced: true,
    graph: {
      ...currentGraph,
      documents: currentGraph.documents.map((document) => document.id !== sourceId
        ? { ...document, text: `${document.text} tampered` }
        : document)
    }
  })
});
assert.equal(unrelatedSourceMutation.rebuilt, 0, "rebuild should reject replacements that alter another saved source record");
assert.equal(unrelatedSourceMutation.failures[0], "Attention: replacement changed saved source records", "rebuild should expose unintended saved-source mutation");
const sourceContentMutation = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, `${source.text} Source authority test.`),
  replace: (currentGraph, sourceId, extraction, options) => {
    assert.equal(options.preserveSourceContent, true, "saved-source rebuilds should preserve authoritative source content");
    return {
      replaced: true,
      graph: {
        ...replaceSource(currentGraph, sourceId, extraction, options).graph,
        documents: currentGraph.documents.map((document) => document.id === sourceId
          ? { ...document, text: `${document.text} tampered by provider` }
          : document)
      }
    };
  }
});
assert.equal(sourceContentMutation.rebuilt, 0, "rebuild should reject replacements that alter the rebuilt source content");
assert.equal(sourceContentMutation.failures[0], "Attention: replacement changed saved source content", "rebuild should identify source-authority mutations separately from unrelated source changes");
const emptyReplacement = await rebuildSources(graph, {
  extract: (source) => {
    const extraction = extractGraph(source.title, source.text);
    return { ...extraction, nodes: [], edges: [] };
  }
});
assert.equal(emptyReplacement.rebuilt, 0, "rebuild should not count an empty replacement over an existing source representation");
assert.equal(emptyReplacement.failures[0], "Attention: replacement removed all source-linked knowledge", "rebuild should preserve a bounded failure when a provider loses all source-linked knowledge");
const relationDroppingReplacement = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, source.text),
  replace: (currentGraph, sourceId, extraction, options) => {
    assert.equal(options.preserveSourceCategories, true, "saved-source rebuilds should enable category preservation at the graph boundary");
    return { replaced: false, degraded: ["relations"] };
  }
});
assert.equal(relationDroppingReplacement.rebuilt, 0, "rebuild should not count a replacement that loses every source-linked relation");
assert.equal(relationDroppingReplacement.failures[0], "Attention: replacement removed all source-linked relations", "rebuild should identify relation loss as a bounded quality failure");
const adapterGuardedRelationDrop = await rebuildSources(graph, {
  extract: (source) => extractGraph(source.title, source.text),
  replace: (currentGraph, sourceId) => ({
    replaced: true,
    graph: {
      ...currentGraph,
      edges: currentGraph.edges.filter((edge) => !edge.sources.includes(sourceId))
    }
  })
});
assert.equal(adapterGuardedRelationDrop.rebuilt, 0, "rebuild adapter should reject custom replacements that bypass graph-core category preservation");
assert.equal(adapterGuardedRelationDrop.failures[0], "Attention: replacement removed all source-linked relations", "rebuild adapter should report relation loss from injected replacement implementations");
const reviewedEdge = graph.edges[0];
const reviewedEdgeSourceId = reviewedEdge.sources[0];
const reviewedEdgeSourceTitle = graph.documents.find((document) => document.id === reviewedEdgeSourceId)?.title;
const reviewedRelationGraph = applyFeedback(graph, "edge", reviewedEdge.id, "down").graph;
const reviewedRelationDrop = await rebuildSources(reviewedRelationGraph, {
  extract: (source) => extractGraph(source.title, source.text),
  replace: (currentGraph, sourceId, extraction, options) => sourceId === reviewedEdgeSourceId
    ? {
      replaced: true,
      graph: { ...currentGraph, edges: currentGraph.edges.filter((edge) => edge.id !== reviewedEdge.id) }
    }
    : replaceSource(currentGraph, sourceId, extraction, options)
});
assert.equal(reviewedRelationDrop.rebuilt, 1, "rebuild should retain valid replacements while rejecting reviewed relation loss");
assert.equal(reviewedRelationDrop.failures.find((failure) => failure.endsWith("replacement removed or changed a reviewed decision")), `${reviewedEdgeSourceTitle}: replacement removed or changed a reviewed decision`, "rebuilds should protect reviewed relation decisions as well as concepts");
await assert.rejects(
  () => rebuildSources({ ...graph, documents: [{ ...graph.documents[0], id: graph.documents[1].id }, graph.documents[1]] }, { extract: () => null }),
  /normalized graph with source documents/,
  "rebuild should reject duplicate source identities before extraction"
);
await assert.rejects(
  () => rebuildSources({ ...graph, redacted: true }, { extract: () => null }),
  /redacted graph cannot be rebuilt/,
  "rebuild should reject redacted graphs before sending empty source content to an extractor"
);
await assert.rejects(
  () => rebuildSources({ ...graph, integrity: { truncated: { documents: 1 } } }, { extract: () => null }),
  /incomplete or ambiguous graph/,
  "rebuild should reject incomplete imported graphs before extraction"
);
await assert.rejects(
  () => rebuildSources({ ...graph, integrity: { ambiguousEdgeIds: ["edge-1"] } }, { extract: () => null }),
  /incomplete or ambiguous graph/,
  "rebuild should reject ambiguous imported graphs before extraction"
);

console.log("rebuild smoke ok");
