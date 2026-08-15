import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listCodingProjects: vi.fn(),
  createCodingProject: vi.fn(),
  createCodingRun: vi.fn(),
  replacePendingFileChanges: vi.fn(),
  createApprovalRequest: vi.fn(),
}));
const proposalService = vi.hoisted(() => ({ proposeCodeChanges: vi.fn() }));
const selfImprovement = vi.hoisted(() => ({
  readSelfImprovementSource: vi.fn(),
  assertSelfImprovementChanges: vi.fn(),
  applyApprovedSelfImprovement: vi.fn(),
  buildDeterministicSelfImprovementFallback: vi.fn(),
}));

vi.mock("../db", () => db);
vi.mock("../services/coding/taskParser", () => proposalService);
vi.mock("../services/coding/selfImprovement", () => selfImprovement);

import { codingRouter } from "./coding";

function caller() {
  return codingRouter.createCaller({
    user: { id: 7, openId: "test-owner", name: "Test owner", email: null, role: "user", createdAt: new Date(), updatedAt: new Date() } as never,
    req: {} as never,
    res: {} as never,
  });
}

function setSource() {
  db.listCodingProjects.mockResolvedValue([{ id: 44, name: "synapsex-self-improvement" }]);
  selfImprovement.readSelfImprovementSource.mockResolvedValue([{ path: "client/src/pages/Home.tsx", content: "export function Home() {}", language: "tsx" }]);
}

describe("self-improvement mutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts malformed proposal output into a proper tRPC error without creating a run or approval", async () => {
    setSource();
    proposalService.proposeCodeChanges.mockRejectedValue(new Error("Code proposal returned invalid JSON"));

    await expect(caller().selfImprove({ prompt: "File list empty state ko zyada clear bana do" })).rejects.toThrow("Self-improvement proposal ka valid response nahin mila");

    expect(db.createCodingRun).not.toHaveBeenCalled();
    expect(db.createApprovalRequest).not.toHaveBeenCalled();
  });

  it("retries malformed primary output with the secondary structured-output model before creating the approval", async () => {
    setSource();
    proposalService.proposeCodeChanges
      .mockRejectedValueOnce(new Error("Primary response was malformed"))
      .mockResolvedValueOnce({
        romanUrduResponse: "Fallback source diff review ke liye tayar hai.",
        changes: [{ path: "client/src/pages/Home.tsx", operation: "update", content: "export function Home() { return null; }", rationale: "Clear empty state" }],
      });
    db.createCodingRun.mockResolvedValue({ id: 87 });

    const result = await caller().selfImprove({ prompt: "File list empty state ko zyada clear bana do" });

    expect(result.run.id).toBe(87);
    expect(proposalService.proposeCodeChanges).toHaveBeenCalledTimes(2);
    expect(proposalService.proposeCodeChanges).toHaveBeenLastCalledWith(expect.objectContaining({ model: "gpt-5" }));
    expect(db.createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({ runId: 87, actionType: "permanent_operation" }));
  });

  it("creates a reviewed diff and permanent-operation approval from the bounded deterministic fallback after both models fail", async () => {
    setSource();
    proposalService.proposeCodeChanges.mockRejectedValue(new Error("Provider response unavailable"));
    selfImprovement.buildDeterministicSelfImprovementFallback.mockReturnValue({
      romanUrduResponse: "Review-only fallback diff tayar hai.",
      changes: [{ path: "client/src/pages/Home.tsx", operation: "update", content: "export function Home() { return null; }", rationale: "Clear empty state" }],
    });
    db.createCodingRun.mockResolvedValue({ id: 88 });

    const result = await caller().selfImprove({ prompt: "File list empty state ko Roman Urdu mein clear bana do" });

    expect(result.run.id).toBe(88);
    expect(proposalService.proposeCodeChanges).toHaveBeenCalledTimes(2);
    expect(db.replacePendingFileChanges).toHaveBeenCalledWith(expect.objectContaining({ runId: 88 }));
    expect(db.createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({ runId: 88, actionType: "permanent_operation" }));
  });

  it("stores a reviewed source diff and creates a pending permanent-operation approval", async () => {
    setSource();
    proposalService.proposeCodeChanges.mockResolvedValue({
      romanUrduResponse: "Review ke liye source diff tayar hai.",
      changes: [{ path: "client/src/pages/Home.tsx", operation: "update", content: "export function Home() { return null; }", rationale: "Clear empty state" }],
    });
    db.createCodingRun.mockResolvedValue({ id: 86 });

    const result = await caller().selfImprove({ prompt: "File list empty state ko zyada clear bana do" });

    expect(result.run.id).toBe(86);
    expect(db.replacePendingFileChanges).toHaveBeenCalledWith(expect.objectContaining({ runId: 86 }));
    expect(db.createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({ runId: 86, actionType: "permanent_operation" }));
  });
});
