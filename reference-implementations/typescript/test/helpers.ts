import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root (four levels up from `test/`). */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

/** Scratch directory inside the package (never under `/tmp`) for generated test fixtures. */
const SCRATCH_ROOT = path.join(here, ".scratch");

/** Resolves a path relative to the repository root. */
export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/** Resolves a path relative to `examples/` at the repository root. */
export function examplePath(...segments: string[]): string {
  return repoPath("examples", ...segments);
}

/** Creates a fresh scratch directory for a test, nested under `test/.scratch/`. */
export async function tempDir(prefix = "case-"): Promise<string> {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  return mkdtemp(path.join(SCRATCH_ROOT, prefix));
}

/** Writes `content` to `name` inside `dir` and returns the full path. */
export async function writeFixture(dir: string, name: string, content: string): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, content, "utf-8");
  return target;
}
