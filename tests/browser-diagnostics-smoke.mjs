import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareDiagnosticScreenshotPath } from "../scripts/browser-diagnostics.mjs";

const root = await mkdtemp(join(tmpdir(), "llm-field-notes-browser-diagnostics-"));
try {
  const outputDirectory = join(root, "artifacts");
  const screenshotPath = await prepareDiagnosticScreenshotPath(outputDirectory, "chromium");
  assert.equal(screenshotPath, join(outputDirectory, "browser-chromium-failure.png"));
  assert.equal((await lstat(outputDirectory)).isDirectory(), true, "diagnostic output should create a real directory");

  await assert.rejects(
    () => prepareDiagnosticScreenshotPath(outputDirectory, "Chromium"),
    /lowercase letters only/,
    "diagnostic engine names should be bounded before entering a filename"
  );

  const targetDirectory = join(root, "target");
  await mkdir(targetDirectory);
  const directoryLink = join(root, "directory-link");
  await symlink(targetDirectory, directoryLink);
  await assert.rejects(
    () => prepareDiagnosticScreenshotPath(directoryLink, "firefox"),
    /symbolic-link path components/,
    "diagnostic output should reject symlinked directories"
  );

  const parentLink = join(root, "parent-link");
  await symlink(targetDirectory, parentLink);
  await assert.rejects(
    () => prepareDiagnosticScreenshotPath(join(parentLink, "nested"), "webkit"),
    /symbolic-link path components/,
    "diagnostic output should reject symlinked parent path components"
  );
  await assert.rejects(
    () => lstat(join(targetDirectory, "nested")),
    { code: "ENOENT" },
    "diagnostic output should reject a symlinked parent before creating directories outside the requested path"
  );

  const screenshotLink = join(outputDirectory, "browser-webkit-failure.png");
  await writeFile(join(root, "outside.png"), "do not overwrite");
  await symlink(join(root, "outside.png"), screenshotLink);
  await assert.rejects(
    () => prepareDiagnosticScreenshotPath(outputDirectory, "webkit"),
    /screenshot path must not be a symbolic link/,
    "diagnostic output should reject symlinked screenshot paths"
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("browser diagnostics smoke ok");
