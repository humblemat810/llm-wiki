import { lstat, mkdir } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";

async function assertNoSymlinkPath(target) {
  const parsed = parse(target);
  let current = parsed.root;
  const components = target.slice(parsed.root.length).split(sep).filter(Boolean);
  for (const component of components) {
    current = join(current, component);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new Error("BROWSER_SMOKE_ARTIFACT_DIR must not contain symbolic-link path components.");
    }
  }
}

export async function prepareDiagnosticScreenshotPath(directory, engineName) {
  if (typeof directory !== "string" || !directory.trim()) return "";
  if (typeof engineName !== "string" || !/^[a-z]+$/.test(engineName)) {
    throw new Error("Browser diagnostic engine names must contain lowercase letters only.");
  }
  const diagnosticDirectory = resolve(directory);
  await assertNoSymlinkPath(diagnosticDirectory);
  await mkdir(diagnosticDirectory, { recursive: true });
  await assertNoSymlinkPath(diagnosticDirectory);
  const directoryMetadata = await lstat(diagnosticDirectory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("BROWSER_SMOKE_ARTIFACT_DIR must resolve to a real directory.");
  }
  const screenshotPath = resolve(diagnosticDirectory, `browser-${engineName}-failure.png`);
  try {
    const screenshotMetadata = await lstat(screenshotPath);
    if (screenshotMetadata.isSymbolicLink()) {
      throw new Error("browser failure screenshot path must not be a symbolic link.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return screenshotPath;
}
