import assert from "node:assert/strict";
import {
  CHECK_TIMEOUT_MS,
  buildProductionChecks,
  environmentForProductionCheck,
  runProductionCheck,
  runProductionChecks
} from "../scripts/production-check.mjs";

const quiet = () => {};

const timeoutErrors = [];
assert.throws(
  () => runProductionCheck("stalled audit", ["audit"], {
    timeoutMs: 1234,
    spawn: (_command, _args, options) => {
      assert.equal(options.timeout, 1234);
      assert.equal(options.killSignal, "SIGTERM");
      return { error: Object.assign(new Error("spawnSync timed out"), { code: "ETIMEDOUT" }) };
    },
    log: quiet
  }),
  (error) => {
    timeoutErrors.push(error.message);
    return error?.exitCode === 1 && /timed out after 1\.234 seconds/.test(error.message);
  },
  "a timed-out production child should produce an actionable bounded diagnostic"
);
assert.deepEqual(timeoutErrors, ["production check could not complete: stalled audit: timed out after 1.234 seconds"]);

assert.throws(
  () => runProductionCheck("terminated smoke", ["run", "smoke:server"], {
    spawn: () => ({ status: null, signal: "SIGTERM" }),
    log: quiet
  }),
  (error) => error?.exitCode === 1 && /terminated smoke: SIGTERM/.test(error.message),
  "a signal-terminated production child should fail the gate"
);

assert.throws(
  () => runProductionCheck("failed contract", ["run", "release:check"], {
    spawn: () => ({ status: 7, signal: null }),
    log: quiet
  }),
  (error) => error?.exitCode === 7 && /failed contract/.test(error.message),
  "a nonzero production child should preserve its exit status"
);

assert.equal(CHECK_TIMEOUT_MS, 5 * 60 * 1000);
const staticPublicationEnvironment = {
  DEPLOYMENT_MODE: "static-pages",
  PUBLIC_ORIGIN: "https://wiki.example.test/field-notes",
  PUBLIC_REPOSITORY_URL: "https://github.com/example/field-notes",
  BUILD_REVISION: "abcdef1234567890",
  PAGES_DEPLOYMENT_URL: "https://wiki.example.test/field-notes/",
  PAGES_EXPECTED_REVISION: "abcdef1234567890"
};
assert.equal(
  environmentForProductionCheck("Smoke the standalone server lifecycle", staticPublicationEnvironment).PUBLIC_ORIGIN,
  undefined,
  "static publication variables should not contaminate local behavioral tests"
);
assert.equal(
  environmentForProductionCheck("Smoke the standalone server lifecycle", staticPublicationEnvironment).BUILD_REVISION,
  staticPublicationEnvironment.BUILD_REVISION,
  "static publication source revision should remain available to local artifact tests"
);
assert.equal(
  environmentForProductionCheck("Build the static Pages artifact", staticPublicationEnvironment).PUBLIC_ORIGIN,
  staticPublicationEnvironment.PUBLIC_ORIGIN,
  "static publication variables should remain available to Pages build checks"
);
assert(
  buildProductionChecks({
    PAGES_DEPLOYMENT_URL: "https://wiki.example.test/",
    PAGES_EXPECTED_REVISION: "0123456789abcdef"
  }).some(([label]) => label === "Verify the exact deployed Pages origin"),
  "configured deployment checks should include the exact-origin probe"
);
assert.throws(
  () => buildProductionChecks({ PAGES_DEPLOYMENT_URL: "https://wiki.example.test/" }),
  /requires PAGES_EXPECTED_REVISION/,
  "configured deployment checks should require a source revision"
);
assert.throws(
  () => buildProductionChecks({
    PAGES_DEPLOYMENT_URL: "https://wiki.example.test/",
    PAGES_EXPECTED_REVISION: "not-a-revision"
  }),
  /invalid PAGES_EXPECTED_REVISION/,
  "configured deployment checks should reject malformed revisions"
);
assert.equal(
  buildProductionChecks({
    PUBLIC_ORIGIN: "https://wiki.example.test/field-notes",
    PAGES_DEPLOYMENT_URL: "https://wiki.example.test/field-notes/",
    PAGES_EXPECTED_REVISION: "0123456789abcdef"
  }).at(-1)?.[0],
  "Verify the exact deployed Pages origin",
  "equivalent public and deployed origins should be accepted"
);
assert.throws(
  () => buildProductionChecks({
    PUBLIC_ORIGIN: "https://wiki.example.test/field-notes",
    PAGES_DEPLOYMENT_URL: "https://stale.example.test/field-notes/",
    PAGES_EXPECTED_REVISION: "0123456789abcdef"
  }),
  /PUBLIC_ORIGIN and PAGES_DEPLOYMENT_URL to identify the same deployment/,
  "configured deployment checks should reject a probe pointed at a different origin"
);

let propagatedEnvironment;
const testEnvironment = { PATH: "/tmp/test-path", PAGES_DEPLOYMENT_URL: "" };
const productionRuns = [];
runProductionChecks({
  environment: testEnvironment,
  spawn: (_command, args, options) => {
    propagatedEnvironment = options.env;
    productionRuns.push(args);
    return { status: 0, signal: null };
  },
  log: quiet
});
assert.equal(propagatedEnvironment, testEnvironment, "programmatic production runs should pass the supplied environment to child checks");
assert.equal(productionRuns.length, buildProductionChecks(testEnvironment).length);

console.log("production check smoke ok");
