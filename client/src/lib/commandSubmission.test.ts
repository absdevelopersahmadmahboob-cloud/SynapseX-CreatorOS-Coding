import { describe, expect, it, vi } from "vitest";
import { getCommandSubmissionError, submitCodingCommand } from "./commandSubmission";

describe("Command Center submission", () => {
  it("creates a workspace before submitting the first typed task", async () => {
    const createWorkspace = vi.fn().mockResolvedValue({ id: 27 });
    const analyzeTask = vi.fn().mockResolvedValue({});

    const projectId = await submitCodingCommand({ activeProjectId: null, prompt: "  Build a timer API  ", createWorkspace, analyzeTask });

    expect(projectId).toBe(27);
    expect(createWorkspace).toHaveBeenCalledOnce();
    expect(analyzeTask).toHaveBeenCalledWith({ projectId: 27, prompt: "Build a timer API" });
  });

  it("uses the active workspace without creating another one", async () => {
    const createWorkspace = vi.fn();
    const analyzeTask = vi.fn().mockResolvedValue({});

    await submitCodingCommand({ activeProjectId: 9, prompt: "Repair the unit tests", createWorkspace, analyzeTask });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(analyzeTask).toHaveBeenCalledWith({ projectId: 9, prompt: "Repair the unit tests" });
  });

  it("turns a failed browser fetch into a retryable Roman Urdu message", () => {
    expect(getCommandSubmissionError(new Error("fetch failed"))).toContain("Retry");
  });

  it("hides malformed JSON transport details behind a safe Roman Urdu retry message", () => {
    expect(getCommandSubmissionError(new Error("Unexpected token '<', \"<!DOCTYPE\" is not valid JSON"))).toContain("Koi file change ya approval request create nahin hui");
  });
});
