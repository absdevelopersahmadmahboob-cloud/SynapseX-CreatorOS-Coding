import { describe, expect, it } from "vitest";
import { buildVerificationRepairPrompt } from "./repairProposal";

describe("verification repair prompt", () => {
  it("keeps the original requirement and includes each failed check log", () => {
    const prompt = buildVerificationRepairPrompt({
      originalPrompt: "Add a safe authentication endpoint.",
      failures: [{ checkType: "typecheck", logText: "src/auth.ts: unknown property" }],
    });

    expect(prompt).toContain("Add a safe authentication endpoint.");
    expect(prompt).toContain("[typecheck]");
    expect(prompt).toContain("unknown property");
    expect(prompt).toContain("Kisi file ko delete na karein");
  });
});
