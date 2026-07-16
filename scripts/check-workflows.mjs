import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const allowedPermissionValues = new Set(["read", "write", "none"]);

function checkPermissions(workflowFile, permissions, scope) {
  if (permissions === undefined) return;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    throw new Error(`${workflowFile} ${scope} permissions must be a mapping`);
  }
  for (const [permission, value] of Object.entries(permissions)) {
    if (!/^[a-z-]+$/.test(permission) || !allowedPermissionValues.has(value)) {
      throw new Error(`${workflowFile} ${scope} has an invalid permission: ${permission}=${value}`);
    }
  }
}

export async function checkWorkflows() {
  const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:yaml|yml)$/i.test(entry.name))
    .map((entry) => `.github/workflows/${entry.name}`)
    .sort();
  if (!workflowFiles.length) throw new Error("No GitHub workflow files were found.");

  for (const workflowFile of workflowFiles) {
    const workflow = await readFile(new URL(`../${workflowFile}`, import.meta.url), "utf8");
    const workflowDocument = parseDocument(workflow, { uniqueKeys: true });
    if (workflowDocument.errors.length) {
      throw new Error(`${workflowFile} is not valid YAML: ${workflowDocument.errors[0].message}`);
    }
    const workflowConfig = workflowDocument.toJS();
    if (!workflowConfig
      || typeof workflowConfig !== "object"
      || Array.isArray(workflowConfig)
      || typeof workflowConfig.name !== "string"
      || workflowConfig.name.trim() === ""
      || workflowConfig.on === undefined
      || !workflowConfig.jobs
      || typeof workflowConfig.jobs !== "object"
      || Array.isArray(workflowConfig.jobs)
      || Object.keys(workflowConfig.jobs).length === 0) {
      throw new Error(`${workflowFile} must contain a name, trigger, and job map`);
    }
    checkPermissions(workflowFile, workflowConfig.permissions, "top-level");
    const jobNames = new Set(Object.keys(workflowConfig.jobs));
    for (const [jobName, job] of Object.entries(workflowConfig.jobs)) {
      if (!job || typeof job !== "object" || Array.isArray(job) || (!job["runs-on"] && !job.uses)) {
        throw new Error(`${workflowFile} job ${jobName} must define runs-on or uses`);
      }
      checkPermissions(workflowFile, job.permissions, `job ${jobName}`);
      const needs = job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
      if (needs.some((dependency) => typeof dependency !== "string" || !jobNames.has(dependency))) {
        throw new Error(`${workflowFile} job ${jobName} references an unknown dependency`);
      }
      if (job.steps !== undefined && (!Array.isArray(job.steps)
        || job.steps.some((step) => !step || typeof step !== "object" || Array.isArray(step)))) {
        throw new Error(`${workflowFile} job ${jobName} steps must be a list of mappings`);
      }
    }
    if (!/^\s*permissions:\s*$/m.test(workflow)) {
      throw new Error(`${workflowFile} must declare an explicit top-level permissions policy`);
    }
    if (/\bpermissions:\s*write-all\b|\bwrite-all\b/.test(workflow)) {
      throw new Error(`${workflowFile} must not grant write-all permissions`);
    }
    if ([...workflow.matchAll(/^  [a-z-]+:\s+write\s*$/gm)].length) {
      throw new Error(`${workflowFile} must scope write permissions to the job that needs them`);
    }
    if (/^\s*pull_request_target\s*:/m.test(workflow)) {
      throw new Error(`${workflowFile} must not execute untrusted pull requests with pull_request_target`);
    }
    if (!/^\s*concurrency:\s*$/m.test(workflow)) {
      throw new Error(`${workflowFile} must declare concurrency controls`);
    }
    const mutableActions = [...workflow.matchAll(/^\s*uses:\s*([^\s@]+)@([^\s#]+)/gm)]
      .filter((match) => !/^[0-9a-f]{40}$/i.test(match[2]));
    if (mutableActions.length) {
      throw new Error(`${workflowFile} contains mutable GitHub Action references: ${mutableActions.map((match) => `${match[1]}@${match[2]}`).join(", ")}`);
    }
    const checkoutCount = [...workflow.matchAll(/^\s*uses:\s*actions\/checkout@[^\s#]+/gm)].length;
    const disabledCheckoutCredentialCount = [...workflow.matchAll(/^\s*persist-credentials:\s*false\s*$/gm)].length;
    if (disabledCheckoutCredentialCount < checkoutCount) {
      throw new Error(`${workflowFile} must disable persisted checkout credentials`);
    }
  }
  return workflowFiles;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workflowFiles = await checkWorkflows();
  console.log(`workflow check ok: ${workflowFiles.length} workflows`);
}
