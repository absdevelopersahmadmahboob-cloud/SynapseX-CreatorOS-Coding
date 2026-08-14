import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { approvalRequests, codingFileChanges, codingProjects, codingRuns, projectSnapshots, type InsertUser, users, verificationRuns, workspaceFiles } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { storageGetSignedUrl, storagePut } from "./storage";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) _db = drizzle(process.env.DATABASE_URL);
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await requireDb();
  const values: InsertUser = { ...user, lastSignedIn: user.lastSignedIn ?? new Date() };
  if (user.openId === ENV.ownerOpenId) values.role = "admin";
  await db.insert(users).values(values).onDuplicateKeyUpdate({
    set: { name: values.name, email: values.email, loginMethod: values.loginMethod, lastSignedIn: new Date(), role: values.role },
  });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createCodingProject(input: { ownerId: number; name: string }) {
  const db = await requireDb();
  const workspaceKey = crypto.randomUUID();
  await db.insert(codingProjects).values({ ...input, workspaceKey });
  const created = await db.select().from(codingProjects).where(eq(codingProjects.workspaceKey, workspaceKey)).limit(1);
  return created[0]!;
}

export async function listCodingProjects(ownerId: number) {
  const db = await requireDb();
  return db.select().from(codingProjects).where(eq(codingProjects.ownerId, ownerId)).orderBy(desc(codingProjects.updatedAt));
}

export async function getCodingProject(ownerId: number, projectId: number) {
  const db = await requireDb();
  const result = await db.select().from(codingProjects).where(and(eq(codingProjects.id, projectId), eq(codingProjects.ownerId, ownerId))).limit(1);
  return result[0];
}

export async function createCodingRun(input: {
  projectId: number;
  ownerId: number;
  prompt: string;
  inputLanguage: string;
  taskType: string;
  deliverable: string;
  taskJson: string;
  assistantResponse: string;
  status: "planned" | "needs_approval";
}) {
  const db = await requireDb();
  const marker = crypto.randomUUID();
  await db.insert(codingRuns).values({ ...input, taskJson: JSON.stringify({ marker, task: JSON.parse(input.taskJson) }) });
  const created = await db.select().from(codingRuns).where(and(eq(codingRuns.ownerId, input.ownerId), eq(codingRuns.projectId, input.projectId))).orderBy(desc(codingRuns.id)).limit(1);
  return created[0]!;
}

export async function listCodingRuns(ownerId: number, projectId: number) {
  const db = await requireDb();
  return db.select().from(codingRuns).where(and(eq(codingRuns.ownerId, ownerId), eq(codingRuns.projectId, projectId))).orderBy(desc(codingRuns.createdAt));
}

export async function getCodingRun(ownerId: number, runId: number) {
  const db = await requireDb();
  const result = await db.select().from(codingRuns).where(and(eq(codingRuns.ownerId, ownerId), eq(codingRuns.id, runId))).limit(1);
  return result[0];
}

export async function updateCodingRun(runId: number, values: { status?: "planned" | "awaiting_review" | "verifying" | "passed" | "failed" | "needs_approval"; assistantResponse?: string }) {
  const db = await requireDb();
  await db.update(codingRuns).set(values).where(eq(codingRuns.id, runId));
}

export async function listWorkspaceFiles(ownerId: number, projectId: number) {
  const db = await requireDb();
  const project = await getCodingProject(ownerId, projectId);
  if (!project) return [];
  const rows = await db.select().from(workspaceFiles).where(eq(workspaceFiles.projectId, projectId)).orderBy(asc(workspaceFiles.path));
  return Promise.all(rows.map(async file => ({ ...file, content: await readStorageText(file.contentKey) })));
}

export async function saveWorkspaceFile(input: { ownerId: number; projectId: number; path: string; content: string; language: string }) {
  const db = await requireDb();
  const project = await getCodingProject(input.ownerId, input.projectId);
  if (!project) return undefined;
  const stored = await storagePut(`codeforge/${input.ownerId}/${input.projectId}/${input.path}`, input.content, "text/plain; charset=utf-8");
  const existing = await db.select().from(workspaceFiles).where(and(eq(workspaceFiles.projectId, input.projectId), eq(workspaceFiles.path, input.path))).limit(1);
  if (existing[0]) {
    await db.update(workspaceFiles).set({ contentKey: stored.key, language: input.language }).where(eq(workspaceFiles.id, existing[0].id));
  } else {
    await db.insert(workspaceFiles).values({ projectId: input.projectId, path: input.path, contentKey: stored.key, language: input.language });
  }
  const saved = await db.select().from(workspaceFiles).where(and(eq(workspaceFiles.projectId, input.projectId), eq(workspaceFiles.path, input.path))).limit(1);
  return saved[0] ? { ...saved[0], content: input.content } : undefined;
}

export async function deleteWorkspaceFile(input: { ownerId: number; projectId: number; path: string }) {
  const db = await requireDb();
  const project = await getCodingProject(input.ownerId, input.projectId);
  if (!project) return false;
  await db.delete(workspaceFiles).where(and(eq(workspaceFiles.projectId, input.projectId), eq(workspaceFiles.path, input.path)));
  return true;
}

export async function listFileChanges(ownerId: number, runId: number) {
  const db = await requireDb();
  const run = await getCodingRun(ownerId, runId);
  if (!run) return [];
  return db.select().from(codingFileChanges).where(eq(codingFileChanges.runId, runId)).orderBy(asc(codingFileChanges.id));
}

export async function queueVerification(ownerId: number, runId: number) {
  const db = await requireDb();
  const run = await getCodingRun(ownerId, runId);
  if (!run) return false;
  await db.insert(verificationRuns).values([
    { runId, checkType: "typecheck", status: "queued", logText: "Queued for isolated verification runner." },
    { runId, checkType: "lint", status: "queued", logText: "Queued for isolated verification runner." },
    { runId, checkType: "build", status: "queued", logText: "Queued for isolated verification runner." },
    { runId, checkType: "test", status: "queued", logText: "Queued for isolated verification runner." },
  ]);
  return true;
}

export async function listVerificationRuns(ownerId: number, runId: number) {
  const db = await requireDb();
  const run = await getCodingRun(ownerId, runId);
  if (!run) return [];
  return db.select().from(verificationRuns).where(eq(verificationRuns.runId, runId)).orderBy(asc(verificationRuns.id));
}

export async function recordVerificationOutcome(input: { ownerId: number; runId: number; checks: Array<{ checkType: "typecheck" | "lint" | "build" | "test"; status: "passed" | "failed" | "skipped"; logText: string }> }) {
  const db = await requireDb();
  const run = await getCodingRun(input.ownerId, input.runId);
  if (!run) return false;
  for (const check of input.checks) {
    await db.update(verificationRuns).set({ status: check.status, logText: check.logText, completedAt: new Date() }).where(and(eq(verificationRuns.runId, input.runId), eq(verificationRuns.checkType, check.checkType), eq(verificationRuns.status, "queued")));
  }
  const failed = input.checks.some(check => check.status === "failed");
  const passed = input.checks.length > 0 && input.checks.every(check => check.status === "passed" || check.status === "skipped");
  await updateCodingRun(input.runId, {
    status: failed ? "failed" : passed ? "passed" : "verifying",
    assistantResponse: failed ? "Isolated verification mein kam az kam aik check fail hua hai. Neeche log dekh kar repair proposal mangwayein." : passed ? "Isolated verification complete ho gayi hai. Available checks ka nateeja record ho chuka hai." : "Isolated verification abhi mukammal nahin hui.",
  });
  return true;
}

export async function recordRunnerUnavailable(ownerId: number, runId: number, reason: string) {
  const db = await requireDb();
  const run = await getCodingRun(ownerId, runId);
  if (!run) return false;
  await db.update(verificationRuns).set({ status: "skipped", logText: reason, completedAt: new Date() }).where(and(eq(verificationRuns.runId, runId), eq(verificationRuns.status, "queued")));
  await updateCodingRun(runId, { status: "failed", assistantResponse: "Isolated verification runner available nahin tha, is liye code ko verified nahin kaha ja sakta. Runner configure karke changes dobara verify karein." });
  return true;
}

export async function replacePendingFileChanges(input: { ownerId: number; runId: number; changes: Array<{ path: string; operation: "create" | "update" | "delete"; previousContent: string | null; nextContent: string | null; diffText: string }> }) {
  const db = await requireDb();
  const run = await getCodingRun(input.ownerId, input.runId);
  if (!run) return false;
  await db.delete(codingFileChanges).where(and(eq(codingFileChanges.runId, input.runId), eq(codingFileChanges.reviewStatus, "pending")));
  if (input.changes.length) await db.insert(codingFileChanges).values(input.changes.map(change => ({ runId: input.runId, ...change })));
  return true;
}

export async function createApprovalRequest(input: { runId: number; actionType: "delete_file" | "push_live" | "permanent_operation"; description: string }) {
  const db = await requireDb();
  await db.insert(approvalRequests).values(input);
}

export async function listOpenApprovalRequests(ownerId: number, projectId: number) {
  const db = await requireDb();
  return db.select({ approval: approvalRequests, run: codingRuns })
    .from(approvalRequests)
    .innerJoin(codingRuns, eq(approvalRequests.runId, codingRuns.id))
    .where(and(eq(codingRuns.ownerId, ownerId), eq(codingRuns.projectId, projectId), eq(approvalRequests.status, "pending")))
    .orderBy(desc(approvalRequests.createdAt));
}

export async function resolveApprovalRequest(ownerId: number, approvalId: number, approved: boolean) {
  const db = await requireDb();
  const rows = await db.select({ approval: approvalRequests, run: codingRuns }).from(approvalRequests).innerJoin(codingRuns, eq(approvalRequests.runId, codingRuns.id)).where(and(eq(approvalRequests.id, approvalId), eq(codingRuns.ownerId, ownerId))).limit(1);
  const record = rows[0];
  if (!record) return undefined;
  await db.update(approvalRequests).set({ status: approved ? "approved" : "rejected", resolvedAt: new Date() }).where(eq(approvalRequests.id, approvalId));
  return { ...record.approval, runId: record.run.id, status: approved ? "approved" : "rejected" };
}

async function hasApprovedDeletion(runId: number) {
  const db = await requireDb();
  const result = await db.select().from(approvalRequests).where(and(eq(approvalRequests.runId, runId), eq(approvalRequests.actionType, "delete_file"), eq(approvalRequests.status, "approved"))).limit(1);
  return Boolean(result[0]);
}

export async function snapshotProject(ownerId: number, projectId: number, runId: number | null, label: string) {
  const db = await requireDb();
  const files = await listWorkspaceFiles(ownerId, projectId);
  const archive = await storagePut(`codeforge/${ownerId}/${projectId}/snapshots/${crypto.randomUUID()}.json`, JSON.stringify(files.map(file => ({ path: file.path, content: file.content, language: file.language }))), "application/json");
  await db.insert(projectSnapshots).values({ projectId, runId, label, archiveKey: archive.key });
  const created = await db.select().from(projectSnapshots).where(eq(projectSnapshots.projectId, projectId)).orderBy(desc(projectSnapshots.id)).limit(1);
  return created[0]!;
}

export async function acceptFileChanges(ownerId: number, runId: number) {
  const db = await requireDb();
  const run = await getCodingRun(ownerId, runId);
  if (!run) return undefined;
  const changes = await db.select().from(codingFileChanges).where(and(eq(codingFileChanges.runId, runId), eq(codingFileChanges.reviewStatus, "pending"))).orderBy(asc(codingFileChanges.id));
  if (changes.some(change => change.operation === "delete") && !(await hasApprovedDeletion(runId))) return { requiresApproval: true as const };
  const snapshot = await snapshotProject(ownerId, run.projectId, runId, `Before accepting run #${runId}`);
  for (const change of changes) {
    if (change.operation === "create" || change.operation === "update") {
      await saveWorkspaceFile({ ownerId, projectId: run.projectId, path: change.path, content: change.nextContent ?? "", language: inferLanguage(change.path) });
    }
    if (change.operation === "delete") await deleteWorkspaceFile({ ownerId, projectId: run.projectId, path: change.path });
  }
  await db.update(codingFileChanges).set({ reviewStatus: "accepted" }).where(and(eq(codingFileChanges.runId, runId), eq(codingFileChanges.reviewStatus, "pending")));
  await updateCodingRun(runId, { status: "verifying" });
  await queueVerification(ownerId, runId);
  return { requiresApproval: false as const, snapshot };
}

export async function rejectFileChanges(ownerId: number, runId: number) {
  const db = await requireDb();
  const run = await getCodingRun(ownerId, runId);
  if (!run) return false;
  await db.update(codingFileChanges).set({ reviewStatus: "rejected" }).where(and(eq(codingFileChanges.runId, runId), eq(codingFileChanges.reviewStatus, "pending")));
  await updateCodingRun(runId, { status: "planned" });
  return true;
}

export async function listSnapshots(ownerId: number, projectId: number) {
  const db = await requireDb();
  const project = await getCodingProject(ownerId, projectId);
  if (!project) return [];
  return db.select().from(projectSnapshots).where(eq(projectSnapshots.projectId, projectId)).orderBy(desc(projectSnapshots.id));
}

export async function restoreSnapshot(ownerId: number, projectId: number, snapshotId: number) {
  const db = await requireDb();
  const project = await getCodingProject(ownerId, projectId);
  if (!project) return false;
  const result = await db.select().from(projectSnapshots).where(and(eq(projectSnapshots.id, snapshotId), eq(projectSnapshots.projectId, projectId))).limit(1);
  if (!result[0]?.archiveKey) return false;
  const files = JSON.parse(await readStorageText(result[0].archiveKey)) as Array<{ path: string; content: string; language: string }>;
  await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, projectId));
  for (const file of files) await saveWorkspaceFile({ ownerId, projectId, ...file });
  return true;
}

async function readStorageText(key: string) {
  const url = await storageGetSignedUrl(key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Workspace file fetch failed (${response.status})`);
  return response.text();
}

function inferLanguage(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", json: "json", css: "css", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", sh: "shell" };
  return byExtension[extension ?? ""] ?? "text";
}
