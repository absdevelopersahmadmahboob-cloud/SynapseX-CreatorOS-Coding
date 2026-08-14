import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
type ProposedCodeChange = {
  path: string;
  operation: "create" | "update" | "delete";
  content: string | null;
  rationale: string;
};

const SOURCE_ROOT = process.env.SYNAPSEX_SOURCE_ROOT?.trim() || process.cwd();
const ALLOWED_DIRECTORY_PREFIXES = ["client/src/", "server/services/coding/", "client/src/lib/"];
const ALLOWED_EXACT_PATHS = new Set(["server/routers/coding.ts", "shared/coding.ts", "drizzle/schema.ts"]);
const SOURCE_DIRECTORIES = ["client/src", "server/services/coding", "shared"];
const MAX_SOURCE_FILE_BYTES = 300_000;
const MAX_SOURCE_FILES = 80;

export type SelfImprovementSourceFile = { path: string; content: string; language: string };

function toPortablePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isAllowedSelfImprovementPath(value: string): boolean {
  const safePath = toPortablePath(value);
  return ALLOWED_EXACT_PATHS.has(safePath) || ALLOWED_DIRECTORY_PREFIXES.some(prefix => safePath.startsWith(prefix));
}

export function assertSelfImprovementChanges(changes: ProposedCodeChange[]): void {
  if (!changes.length) throw new Error("Self-improvement proposal mein koi source change nahin mila");
  if (changes.length > 25) throw new Error("Self-improvement proposal ek martaba mein 25 source changes tak limited hai");
  for (const change of changes) {
    if (change.operation === "delete") throw new Error("Self-improvement proposal source file delete nahin kar sakta");
    if (!isAllowedSelfImprovementPath(change.path)) throw new Error(`Self-improvement path allowed nahin hai: ${change.path}`);
    if (change.content === null || Buffer.byteLength(change.content, "utf8") > MAX_SOURCE_FILE_BYTES) throw new Error(`Self-improvement content safe limit se bahar hai: ${change.path}`);
  }
}

async function walkSourceDirectory(relativeDirectory: string, result: SelfImprovementSourceFile[]): Promise<void> {
  if (result.length >= MAX_SOURCE_FILES) return;
  const absoluteDirectory = path.join(SOURCE_ROOT, relativeDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (result.length >= MAX_SOURCE_FILES) return;
    const relativePath = toPortablePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      await walkSourceDirectory(relativePath, result);
      continue;
    }
    if (!entry.isFile() || !isAllowedSelfImprovementPath(relativePath)) continue;
    const absolutePath = path.join(SOURCE_ROOT, relativePath);
    const stat = await fs.stat(absolutePath);
    if (stat.size > MAX_SOURCE_FILE_BYTES) continue;
    result.push({ path: relativePath, content: await fs.readFile(absolutePath, "utf8"), language: relativePath.split(".").pop() ?? "text" });
  }
}

export async function readSelfImprovementSource(): Promise<SelfImprovementSourceFile[]> {
  const files: SelfImprovementSourceFile[] = [];
  for (const directory of SOURCE_DIRECTORIES) await walkSourceDirectory(directory, files);
  for (const relativePath of Array.from(ALLOWED_EXACT_PATHS)) {
    if (files.some(file => file.path === relativePath)) continue;
    const absolutePath = path.join(SOURCE_ROOT, relativePath);
    const stat = await fs.stat(absolutePath);
    if (stat.size <= MAX_SOURCE_FILE_BYTES) files.push({ path: relativePath, content: await fs.readFile(absolutePath, "utf8"), language: relativePath.split(".").pop() ?? "text" });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function runProjectCommand(command: string): Promise<{ passed: boolean; log: string }> {
  return new Promise(resolve => {
    const child = spawn("pnpm", ["exec", "sh", "-c", command], { cwd: SOURCE_ROOT, env: process.env, shell: process.platform === "win32" });
    let log = "";
    child.stdout.on("data", chunk => { log += String(chunk); });
    child.stderr.on("data", chunk => { log += String(chunk); });
    child.on("error", error => resolve({ passed: false, log: error.message }));
    child.on("close", code => resolve({ passed: code === 0, log: log.slice(-12000) || `Command exited with ${code}` }));
  });
}

export async function applyApprovedSelfImprovement(changes: ProposedCodeChange[]) {
  assertSelfImprovementChanges(changes);
  const originals = new Map<string, string | null>();
  for (const change of changes) {
    const absolutePath = path.join(SOURCE_ROOT, change.path);
    try { originals.set(change.path, await fs.readFile(absolutePath, "utf8")); } catch { originals.set(change.path, null); }
  }
  for (const change of changes) {
    const absolutePath = path.join(SOURCE_ROOT, change.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, change.content ?? "", "utf8");
  }

  const typecheck = await runProjectCommand("pnpm check");
  const tests = typecheck.passed ? await runProjectCommand("pnpm test") : { passed: false, log: "Tests typecheck failure ki wajah se run nahin huay.\n" + typecheck.log };
  if (typecheck.passed && tests.passed) return { applied: true, checks: { typecheck, tests } };

  for (const [relativePath, content] of Array.from(originals.entries())) {
    const absolutePath = path.join(SOURCE_ROOT, relativePath);
    if (content === null) await fs.rm(absolutePath, { force: true });
    else await fs.writeFile(absolutePath, content, "utf8");
  }
  return { applied: false, checks: { typecheck, tests } };
}
