import { describe, expect, it } from "vitest";
import { buildCodingSystemPrompt } from "./taskParser";

describe("coding task parser contract", () => {
  it("requires whole-prompt interpretation rather than keyword routing", () => {
    const prompt = buildCodingSystemPrompt();
    expect(prompt).toContain("ENTIRE instruction");
    expect(prompt).toContain("isolated keyword");
  });

  it("requires Roman Urdu only for user-facing explanation", () => {
    expect(buildCodingSystemPrompt()).toContain("Roman Urdu");
    expect(buildCodingSystemPrompt()).toContain("Latin characters only");
  });
});

