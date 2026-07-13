export const CORE_SHELL_ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "graph-core.js",
  "graph-store.js",
  "extractor-adapter.js",
  "projection-adapter.js",
  "jsonld-projection.js",
  "storage-adapter.js",
  "evaluation.js",
  "manifest.webmanifest",
  "icon.svg",
  "social-card.svg",
  "sw.js",
  "version.json"
];

export const FIXED_PUBLIC_ASSETS = [
  ...CORE_SHELL_ASSETS,
  "robots.txt",
  "README.md",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "llms.txt",
  "LICENSE",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "experiments/README.md",
  "schema/graph.schema.json",
  "schema/feedback.schema.json",
  "schema/backup.schema.json",
  "schema/diff.schema.json",
  "schema/evaluation-comparison.schema.json",
  "schema/health.schema.json",
  "schema/jsonld.schema.json",
  "schema/vault-manifest.schema.json",
  "schema/extractor-request.schema.json",
  "schema/evaluation.schema.json"
];

export const LEARNING_NOTE_ASSETS = [
  "notes/README.md",
  "notes/tokens.md",
  "notes/embeddings.md",
  "notes/attention.md",
  "notes/training.md",
  "notes/transformers.md",
  "notes/scaling.md",
  "notes/inference.md",
  "notes/evaluation.md",
  "notes/rag.md",
  "notes/finetuning.md",
  "notes/agents.md",
  "notes/production.md"
];

export const PUBLIC_ASSETS = [...FIXED_PUBLIC_ASSETS, ...LEARNING_NOTE_ASSETS];

export const OFFLINE_SHELL_ASSETS = [
  "./",
  ...CORE_SHELL_ASSETS.filter((asset) => asset !== "sw.js" && asset !== "version.json"),
  "LICENSE",
  "README.md",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "llms.txt",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "version.json",
  "schema/graph.schema.json",
  "schema/feedback.schema.json",
  "schema/backup.schema.json",
  "schema/diff.schema.json",
  "schema/extractor-request.schema.json",
  "schema/evaluation.schema.json",
  "schema/evaluation-comparison.schema.json",
  "schema/health.schema.json",
  "schema/jsonld.schema.json",
  ...LEARNING_NOTE_ASSETS
];
