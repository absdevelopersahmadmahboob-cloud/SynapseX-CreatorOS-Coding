import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const [owner, repo] = (process.env.SYNAPSEX_GITHUB_REPOSITORY ?? "").split("/");
const token = process.env.GH_TOKEN;
const root = process.cwd();

if (!owner || !repo || !token) {
  throw new Error("Set SYNAPSEX_GITHUB_REPOSITORY=owner/repository and ensure GH_TOKEN is available.");
}

const ignoredDirectories = new Set([".git", ".manus-logs", "dist", "node_modules"]);
const ignoredFiles = new Set([".project-config.json"]);

async function github(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
  return response.json();
}

async function collectFiles(directory = root, relative = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await collectFiles(path.join(directory, entry.name), entryRelative));
    } else if (entry.isFile() && !ignoredFiles.has(entry.name)) {
      files.push(entryRelative);
    }
  }
  return files;
}

async function createBlob(filePath) {
  const data = await fs.readFile(path.join(root, filePath));
  const blob = await github(`/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: data.toString("base64"), encoding: "base64" }),
  });
  const stat = await fs.stat(path.join(root, filePath));
  return {
    path: filePath,
    mode: stat.mode & 0o111 ? "100755" : "100644",
    type: "blob",
    sha: blob.sha,
  };
}

const files = await collectFiles();
const tree = [];
for (const filePath of files) tree.push(await createBlob(filePath));

const createdTree = await github(`/repos/${owner}/${repo}/git/trees`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tree }),
});

const sourceHash = createHash("sha256").update(tree.map(entry => `${entry.path}:${entry.sha}`).join("\n")).digest("hex").slice(0, 12);
const commit = await github(`/repos/${owner}/${repo}/git/commits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: `feat: initialize SynapseX CreatorOS Coding (${sourceHash})`, tree: createdTree.sha }),
});

await github(`/repos/${owner}/${repo}/git/refs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ref: "refs/heads/main", sha: commit.sha }),
});

console.log(`Published ${files.length} tracked files to https://github.com/${owner}/${repo}/tree/main`);
