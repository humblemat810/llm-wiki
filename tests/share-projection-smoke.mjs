import assert from "node:assert/strict";
import { buildShareGraph, buildSharePayload, buildShareUrl, decodeSharePayload, encodeSharePayload, MAX_SHARE_PAYLOAD_BYTES, SHARE_FORMAT, SHARE_IMPORT_FORMAT } from "../share-projection.js";

const graph = {
  documents: [{ id: "private-source", title: "Private", text: "secret", uri: "https://private.invalid" }],
  nodes: [
    { id: "private-node-id", label: "Retrieval", type: "concept", status: "accepted", confidence: 0.9 },
    { id: "rejected", label: "Do not publish", type: "concept", status: "rejected", confidence: 1 }
  ],
  edges: [{ id: "private-edge-id", source: "private-node-id", target: "private-node-id", label: "supports", status: "accepted", confidence: 0.8 }]
};

const payload = buildSharePayload(graph);
assert.equal(payload.format, SHARE_FORMAT);
assert.deepEqual(payload.nodes.map((node) => node.id), ["n0"]);
assert.equal(payload.edges[0].source, "n0");
assert.equal(payload.documents, 1);
assert(!JSON.stringify(payload).includes("private-source"));
assert(!JSON.stringify(payload).includes("private-node-id"));
const encoded = encodeSharePayload(payload);
assert.deepEqual(decodeSharePayload(encoded), payload);
const forked = buildShareGraph(payload);
assert.equal(forked.schema, "llm-field-notes/graph@1");
assert.equal(forked.redacted, true);
assert.equal(forked.shareImport, SHARE_IMPORT_FORMAT);
assert.equal(forked.nodes[0].id, "shared-0");
assert.equal(forked.edges[0].source, "shared-0");
assert.equal(forked.edges[0].target, "shared-0");
assert.deepEqual(forked.nodes[0].evidence, []);
assert.deepEqual(forked.nodes[0].sources, []);
assert(buildShareUrl({ href: "https://wiki.example.test/llm-wiki/" }, graph).includes("/llm-wiki/share.html#graph="));
const privateLocationShare = buildShareUrl({ href: "https://user:password@wiki.example.test/llm-wiki/?session=private" }, graph);
assert(!privateLocationShare.includes("user:password"), "graph share URLs must not preserve URL credentials");
assert(!privateLocationShare.includes("session=private"), "graph share URLs must not preserve URL query parameters");
assert.throws(
  () => encodeSharePayload({ ...payload, nodes: [{ label: "x".repeat(MAX_SHARE_PAYLOAD_BYTES) }] }),
  /too large for a share link/
);
assert.throws(() => decodeSharePayload("not-valid"), /share link payload is invalid/);
const duplicateEncoded = Buffer.from('{"format":"llm-field-notes/share@1","format":"llm-field-notes/share@1"}').toString("base64url");
assert.throws(
  () => decodeSharePayload(duplicateEncoded),
  /duplicate object key/,
  "browser share decoding should reject duplicate JSON keys before validation"
);
assert.throws(
  () => decodeSharePayload(encodeSharePayload({
    ...payload,
    nodes: [{ ...payload.nodes[0], secret: "source text must not cross the boundary" }]
  })),
  /invalid concept/
);
assert.throws(
  () => decodeSharePayload(encodeSharePayload({
    ...payload,
    edges: [{ ...payload.edges[0], target: "missing-node" }]
  })),
  /invalid relation/
);
assert.throws(
  () => decodeSharePayload(encodeSharePayload({
    ...payload,
    nodes: [{ ...payload.nodes[0] }, { ...payload.nodes[0] }]
  })),
  /invalid concept/
);
console.log("share projection smoke ok");
