import { describe, expect, it } from "vitest";
import { approvalMessage, requiresExplicitApproval } from "./approvalPolicy";

describe("irreversible action approval policy", () => {
  it("requires approval for deletion, live pushes, and permanent operations", () => {
    expect(requiresExplicitApproval("delete_file")).toBe(true);
    expect(requiresExplicitApproval("push_live")).toBe(true);
    expect(requiresExplicitApproval("permanent_operation")).toBe(true);
  });

  it("describes a live push as approval-gated before remote work begins", () => {
    expect(approvalMessage("push_live")).toContain("explicit approval");
    expect(approvalMessage("push_live")).toContain("remote commit");
  });
});

