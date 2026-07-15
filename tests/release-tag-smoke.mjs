import assert from "node:assert/strict";
import { validateReleaseTag } from "../scripts/check-release-tag.mjs";

assert.equal(validateReleaseTag("v1.2.3", "1.2.3", "stable"), true);
assert.throws(
  () => validateReleaseTag("1.2.3", "1.2.3", "stable"),
  /does not match package version/,
  "release tags should require the v-prefixed package version"
);
assert.throws(
  () => validateReleaseTag("v1.2.3", "1.2.3", "unreleased"),
  /stable release channel/,
  "unreleased metadata should not be publishable as a versioned release"
);
assert.throws(
  () => validateReleaseTag("v1.2.4", "1.2.3", "stable"),
  /does not match package version/,
  "release tags should reject version drift"
);
console.log("release tag smoke ok");
