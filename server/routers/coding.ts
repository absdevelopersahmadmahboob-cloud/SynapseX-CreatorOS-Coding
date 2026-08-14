import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { parseCodingTask, proposeCodeChanges } from "../services/coding/taskParser";
import { approvalMessage } from "../services/coding/approvalPolicy";
import { executeIsolatedVerification } from "../services/coding/verificationRunner";
import { buildVerificationRepairPrompt } from "../services/coding/repairProposal";
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
