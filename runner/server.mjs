import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 8787);
const token = process.env.RUNNER_TOKEN;
const maxBodyBytes = 12 * 1024 * 1024;
const checkScripts = {
  typecheck: ["typecheck", "check"],
  lint: ["lint"],
  build: ["build"],
  test: ["test"],
};

if (!token) throw new Error("RUNNER_TOKEN is required.");

function respond(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) reject(new Error("Payload is too large."));
      else body += chunk;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error("Request body must be valid JSON.")); }
    });
    req.on("error", reject);
  });
}

function safeRelativePath(filePath) {
  return typeof filePath === "string" && filePath.length > 0 && !filePath.startsWith("/") && !filePath.includes("\\") && !filePath.split("/").includes("..");
}

async function materializeFiles(root, files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("At least one workspace file is required.");
  for (const file of files) {
    if (!safeRelativePath(file.path) || typeof file.content !== "string") throw new Error("Workspace contains an unsafe file path or invalid content.");
    const target = path.resolve(root, file.path);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Workspace path escapes its isolated root.");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}

function execute(command, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, shell: false, env: { ...process.env, CI: "true", npm_config_audit: "false", npm_config_fund: "false" } });
    let output = "";
    const capture = chunk => { if (output.length < 250_000) output += chunk.toString(); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60 * 1000);
    child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? 1, output: output || "Command completed without output." }); });
    child.on("error", error => { clearTimeout(timer); resolve({ code: 1, output: error.message }); });
  });
}

async function prepareDependencies(root, packageJson) {
  const dependencyCount = [packageJson.dependencies, packageJson.devDependencies, packageJson.optionalDependencies].reduce((total, group) => total + Object.keys(group ?? {}).length, 0);
  if (dependencyCount === 0) return { code: 0, output: "Workspace declares no Node dependencies." };
  try { await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"); } catch { return { code: 1, output: "Dependency installation requires a committed pnpm-lock.yaml for reproducible isolated verification." }; }
  return execute("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], root);
}

async function runChecks(root, requestedChecks) {
  let packageJson;
  try { packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")); } catch { packageJson = {}; }
  const scripts = packageJson.scripts ?? {};
  const installation = await prepareDependencies(root, packageJson);
  if (installation.code !== 0) return requestedChecks.map(checkType => ({ checkType, status: "failed", logText: `Dependency preparation failed before ${checkType}.\n${installation.output}` }));
  const checks = [];
  for (const checkType of requestedChecks) {
    const script = (checkScripts[checkType] ?? []).find(name => typeof scripts[name] === "string");
    if (!script) {
      checks.push({ checkType, status: "skipped", logText: `No compatible package.json script found for ${checkType}.` });
      continue;
    }
    const result = await execute("pnpm", ["run", script], root);
    checks.push({ checkType, status: result.code === 0 ? "passed" : "failed", logText: result.output });
  }
  return checks;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return respond(res, 200, { status: "ok" });
  if (req.method !== "POST" || req.url !== "/execute") return respond(res, 404, { error: "Not found." });
  if (req.headers.authorization !== `Bearer ${token}`) return respond(res, 401, { error: "Unauthorized." });
  let root;
  try {
    const request = await readJson(req);
    const requestedChecks = Array.isArray(request.checks) ? request.checks.filter(check => ["typecheck", "lint", "build", "test"].includes(check)) : [];
    if (!requestedChecks.length) throw new Error("At least one valid verification check is required.");
    root = await mkdtemp(path.join(tmpdir(), "synapsex-run-"));
    await materializeFiles(root, request.files);
    const checks = await runChecks(root, requestedChecks);
    return respond(res, 200, { checks });
  } catch (error) {
    return respond(res, 400, { error: error instanceof Error ? error.message : "Runner execution failed." });
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`SynapseX isolated verification runner listening on ${port}`));
