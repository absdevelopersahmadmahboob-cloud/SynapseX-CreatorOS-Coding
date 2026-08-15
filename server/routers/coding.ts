import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { parseCodingTask, proposeCodeChanges } from "../services/coding/taskParser";
import { approvalMessage } from "../services/coding/approvalPolicy";
import { executeIsolatedVerification } from "../services/coding/verificationRunner";
import { buildVerificationRepairPrompt } from "../services/coding/repairProposal";
import { applyApprovedSelfImprovement, assertSelfImprovementChanges, buildDeterministicSelfImprovementFallback, readSelfImprovementSource } from "../services/coding/selfImprovement";
import { protectedProcedure, router } from "../_core/trpc";

const projectInput = z.object({ name: z.string().trim().min(1).max(120) });
const safePath = z.string().trim().min(1).max(1024).refine(path => !path.startsWith("/") && !path.includes("..") && !path.includes("\\"), "Use a safe relative file path");
const workspaceFileInput = z.object({ projectId: z.number().int().positive(), path: safePath, content: z.string().max(2_000_000), language: z.string().trim().min(1).max(48) });

export const codingRouter = router({
  listProjects: protectedProcedure.query(({ ctx }) => db.listCodingProjects(ctx.user.id)),

  createProject: protectedProcedure.input(projectInput).mutation(({ ctx, input }) => db.createCodingProject({ ownerId: ctx.user.id, name: input.name })),

  listFiles: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(({ ctx, input }) => db.listWorkspaceFiles(ctx.user.id, input.projectId)),

  saveFile: protectedProcedure.input(workspaceFileInput).mutation(async ({ ctx, input }) => {
    const saved = await db.saveWorkspaceFile({ ...input, ownerId: ctx.user.id });
    if (!saved) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    return saved;
  }),

  deleteFile: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), path: safePath })).mutation(async ({ ctx, input }) => {
    const removed = await db.deleteWorkspaceFile({ ...input, ownerId: ctx.user.id });
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    return { success: true };
  }),

  listRuns: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(({ ctx, input }) => db.listCodingRuns(ctx.user.id, input.projectId)),

  analyzeTask: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), prompt: z.string().trim().min(2).max(20000) })).mutation(async ({ ctx, input }) => {
    const project = await db.getCodingProject(ctx.user.id, input.projectId);
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    const task = await parseCodingTask(input.prompt);
    const run = await db.createCodingRun({
      projectId: project.id,
      ownerId: ctx.user.id,
      prompt: input.prompt,
      inputLanguage: task.inputLanguage,
      taskType: task.taskType,
      deliverable: task.deliverable,
      taskJson: JSON.stringify(task),
      assistantResponse: task.romanUrduResponse,
      status: task.confirmationRequired ? "needs_approval" : "planned",
    });
    if (task.confirmationRequired && task.confirmationReason) await db.createApprovalRequest({ runId: run.id, actionType: "permanent_operation", description: task.confirmationReason });
    return { run, task };
  }),

  selfImprove: protectedProcedure.input(z.object({ prompt: z.string().trim().min(10).max(12000) })).mutation(async ({ ctx, input }) => {
    const projectName = "synapsex-self-improvement";
    const project = (await db.listCodingProjects(ctx.user.id)).find(item => item.name === projectName)
      ?? await db.createCodingProject({ ownerId: ctx.user.id, name: projectName });
    const sourceFiles = await readSelfImprovementSource();
    const task = {
      inputLanguage: "unknown", taskType: "self-improvement", executionMode: "propose_code" as const, deliverableKind: "other" as const, localScriptKind: "none" as const,
      deliverable: "SynapseX source improvement proposal", scope: ["Allowed SynapseX application source"],
      implementationPlan: ["Restricted source proposal banana", "Diff review aur explicit approval lena", "Approval ke baad local checks chalana"], verificationPlan: ["pnpm check", "pnpm test"],
      confirmationRequired: true, confirmationReason: "SynapseX ke apne source code mein change ke liye explicit approval zaroori hai.",
      romanUrduResponse: "SynapseX improvement proposal tayar ho raha hai. Koi apna source code approval ke baghair change nahin hoga.", selfImprovement: true,
    };
    const proposalInput = {
      userPrompt: `SynapseX CreatorOS Coding ke apne allowed source ko improve karo. User ka improvement brief: ${input.prompt}\n\nSirf functional source change propose karo. Secrets, deployment config, dependencies aur source deletion allowed nahin hain.`,
      taskJson: JSON.stringify(task), files: sourceFiles,
    };
    let proposal: Awaited<ReturnType<typeof proposeCodeChanges>>;
    try {
      proposal = await proposeCodeChanges(proposalInput);
    } catch (primaryError) {
      try {
        proposal = await proposeCodeChanges({ ...proposalInput, model: "gpt-5" });
      } catch (fallbackError) {
        console.error("Self-improvement proposal failed after primary and fallback attempts", {
          primary: primaryError instanceof Error ? primaryError.message : "unknown",
          fallback: fallbackError instanceof Error ? fallbackError.message : "unknown",
        });
        const deterministicProposal = buildDeterministicSelfImprovementFallback({ prompt: input.prompt, sourceFiles });
        if (!deterministicProposal) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Self-improvement proposal ka valid response nahin mila. Koi source change ya approval request create nahin hui; kuch seconds baad Retry karein." });
        }
        proposal = deterministicProposal;
      }
    }
    assertSelfImprovementChanges(proposal.changes);
    const run = await db.createCodingRun({ projectId: project.id, ownerId: ctx.user.id, prompt: input.prompt, inputLanguage: task.inputLanguage, taskType: task.taskType, deliverable: task.deliverable, taskJson: JSON.stringify(task), assistantResponse: proposal.romanUrduResponse, status: "needs_approval" });
    const existingFiles = new Map(sourceFiles.map(file => [file.path, file]));
    await db.replacePendingFileChanges({ ownerId: ctx.user.id, runId: run.id, changes: proposal.changes.map(change => ({ path: change.path, operation: change.operation, previousContent: existingFiles.get(change.path)?.content ?? null, nextContent: change.content, diffText: makeDiff(change.path, existingFiles.get(change.path)?.content ?? null, change.content) })) });
    await db.createApprovalRequest({ runId: run.id, actionType: "permanent_operation", description: "SynapseX ke allowed source diff ko apply karna hai. Approval ke baad pnpm check aur pnpm test chalenge; fail hone par source rollback hoga." });
    return { run, proposal };
  }),

  listChanges: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).query(({ ctx, input }) => db.listFileChanges(ctx.user.id, input.runId)),

  listVerification: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).query(({ ctx, input }) => db.listVerificationRuns(ctx.user.id, input.runId)),

  generateChanges: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const run = await db.getCodingRun(ctx.user.id, input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    if (run.status === "needs_approval") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Resolve the approval request before generating code" });
    const files = await db.listWorkspaceFiles(ctx.user.id, run.projectId);
    const proposal = await proposeCodeChanges({ userPrompt: run.prompt, taskJson: run.taskJson, files });
    const existingFiles = new Map(files.map(file => [file.path, file]));
    const changes = proposal.changes.map(change => ({
      path: change.path,
      operation: change.operation,
      previousContent: existingFiles.get(change.path)?.content ?? null,
      nextContent: change.content,
      diffText: makeDiff(change.path, existingFiles.get(change.path)?.content ?? null, change.content),
    }));
    await db.replacePendingFileChanges({ ownerId: ctx.user.id, runId: run.id, changes });
    const deletion = changes.find(change => change.operation === "delete");
    if (deletion) {
      await db.createApprovalRequest({ runId: run.id, actionType: "delete_file", description: `Proposed deletion: ${deletion.path}. Approve only after reviewing the diff.` });
      await db.updateCodingRun(run.id, { status: "needs_approval", assistantResponse: proposal.romanUrduResponse });
    } else {
      await db.updateCodingRun(run.id, { status: "awaiting_review", assistantResponse: proposal.romanUrduResponse });
    }
    return proposal;
  }),

  acceptChanges: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const result = await db.acceptFileChanges(ctx.user.id, input.runId);
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    if (result.requiresApproval) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Deletion requires explicit approval before accepting this change set" });
    const run = await db.getCodingRun(ctx.user.id, input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    try {
      const verification = await executeIsolatedVerification({ runId: run.id, files: await db.listWorkspaceFiles(ctx.user.id, run.projectId) });
      if (!verification.configured) await db.recordRunnerUnavailable(ctx.user.id, run.id, "CODE_RUNNER_URL aur CODE_RUNNER_TOKEN configure nahin hain; isolated verification execute nahin hui.");
      else await db.recordVerificationOutcome({ ownerId: ctx.user.id, runId: run.id, checks: verification.checks });
    } catch (error) {
      await db.recordRunnerUnavailable(ctx.user.id, run.id, `Isolated verification runner error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    return result;
  }),

  rejectChanges: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const rejected = await db.rejectFileChanges(ctx.user.id, input.runId);
    if (!rejected) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    return { success: true };
  }),

  acceptSelfImprovement: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const run = await db.getCodingRun(ctx.user.id, input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    const storedTask = JSON.parse(run.taskJson) as { selfImprovement?: boolean };
    if (!storedTask.selfImprovement) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This run is not a self-improvement proposal" });
    if (run.status !== "awaiting_review") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Explicit approval is required before applying a self-improvement proposal" });
    const changes = await db.listFileChanges(ctx.user.id, run.id);
    const result = await applyApprovedSelfImprovement(changes.filter(change => change.reviewStatus === "pending").map(change => ({ path: change.path, operation: change.operation, content: change.nextContent, rationale: "Approved self-improvement diff" })));
    const logText = `pnpm check\n${result.checks.typecheck.log}\n\npnpm test\n${result.checks.tests.log}`;
    if (result.applied) {
      await db.acceptPendingFileChanges(ctx.user.id, run.id);
      await db.recordCustomVerification({ ownerId: ctx.user.id, runId: run.id, passed: true, logText, assistantResponse: "Approved self-improvement source changes apply ho gayi hain aur local typecheck aur tests pass ho gaye hain." });
    } else {
      await db.rejectFileChanges(ctx.user.id, run.id);
      await db.recordCustomVerification({ ownerId: ctx.user.id, runId: run.id, passed: false, logText, assistantResponse: "Self-improvement checks fail huay, is liye proposed source changes rollback kar di gayi hain. Logs review karke naya proposal mangwayein." });
    }
    return result;
  }),

  requestRepair: protectedProcedure.input(z.object({ runId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const run = await db.getCodingRun(ctx.user.id, input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    const verification = await db.listVerificationRuns(ctx.user.id, run.id);
    const failures = verification.filter(check => check.status === "failed").map(check => ({ checkType: check.checkType, logText: check.logText }));
    if (!failures.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No failed verification result is available for repair" });
    const files = await db.listWorkspaceFiles(ctx.user.id, run.projectId);
    const proposal = await proposeCodeChanges({ userPrompt: buildVerificationRepairPrompt({ originalPrompt: run.prompt, failures }), taskJson: run.taskJson, files });
    const existingFiles = new Map(files.map(file => [file.path, file]));
    const changes = proposal.changes.map(change => ({
      path: change.path,
      operation: change.operation,
      previousContent: existingFiles.get(change.path)?.content ?? null,
      nextContent: change.content,
      diffText: makeDiff(change.path, existingFiles.get(change.path)?.content ?? null, change.content),
    }));
    if (changes.some(change => change.operation === "delete")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Repair proposal included a deletion and requires a new reviewed proposal" });
    await db.replacePendingFileChanges({ ownerId: ctx.user.id, runId: run.id, changes });
    await db.updateCodingRun(run.id, { status: "awaiting_review", assistantResponse: proposal.romanUrduResponse });
    return proposal;
  }),

  listApprovals: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(({ ctx, input }) => db.listOpenApprovalRequests(ctx.user.id, input.projectId)),

  resolveApproval: protectedProcedure.input(z.object({ approvalId: z.number().int().positive(), approved: z.boolean() })).mutation(async ({ ctx, input }) => {
    const approval = await db.resolveApprovalRequest(ctx.user.id, input.approvalId, input.approved);
    if (!approval) throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
    if (approval.actionType === "delete_file" && input.approved) await db.updateCodingRun(approval.runId, { status: "awaiting_review" });
    if (approval.actionType === "permanent_operation" && input.approved) await db.updateCodingRun(approval.runId, { status: "awaiting_review" });
    if (!input.approved) await db.updateCodingRun(approval.runId, { status: "planned" });
    return approval;
  }),

  requestLivePushApproval: protectedProcedure.input(z.object({ runId: z.number().int().positive(), destination: z.string().trim().min(1).max(300) })).mutation(async ({ ctx, input }) => {
    const run = await db.getCodingRun(ctx.user.id, input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    await db.createApprovalRequest({ runId: run.id, actionType: "push_live", description: `${approvalMessage("push_live")} Destination: ${input.destination}` });
    return { success: true };
  }),

  listSnapshots: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(({ ctx, input }) => db.listSnapshots(ctx.user.id, input.projectId)),

  restoreSnapshot: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), snapshotId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const restored = await db.restoreSnapshot(ctx.user.id, input.projectId, input.snapshotId);
    if (!restored) throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" });
    return { success: true };
  }),
});

function makeDiff(path: string, previousContent: string | null, nextContent: string | null) {
  const before = previousContent?.split("\n") ?? [];
  const after = nextContent?.split("\n") ?? [];
  return [`--- a/${path}`, `+++ b/${path}`, ...before.map(line => `-${line}`), ...after.map(line => `+${line}`)].join("\n");
}
