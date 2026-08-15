import { describe, expect, it } from "vitest";
import { assertSelfImprovementChanges, buildDeterministicSelfImprovementFallback, isAllowedSelfImprovementPath } from "./selfImprovement";

describe("self-improvement source boundary", () => {
  it("permits application source paths but not deployment or secret paths", () => {
    expect(isAllowedSelfImprovementPath("client/src/pages/Home.tsx")).toBe(true);
    expect(isAllowedSelfImprovementPath("server/services/coding/taskParser.ts")).toBe(true);
    expect(isAllowedSelfImprovementPath("package.json")).toBe(false);
    expect(isAllowedSelfImprovementPath(".env")).toBe(false);
  });

  it("rejects source deletions and accepts a reviewed source update", () => {
    expect(() => assertSelfImprovementChanges([{ path: "client/src/pages/Home.tsx", operation: "delete", content: null, rationale: "remove" }])).toThrow("delete");
    expect(() => assertSelfImprovementChanges([{ path: "client/src/pages/Home.tsx", operation: "update", content: "export {}", rationale: "improve" }])).not.toThrow();
  });

  it("builds a bounded review-only fallback for the Roman Urdu file-list empty-state brief", () => {
    const proposal = buildDeterministicSelfImprovementFallback({
      prompt: "Command Center mein file list ke empty state ko Roman Urdu mein zyada clear bana do.",
      sourceFiles: [{ path: "client/src/pages/Home.tsx", content: 'const emptyLabel = "No file selected";', language: "tsx" }],
    });

    expect(proposal?.changes).toEqual([expect.objectContaining({
      path: "client/src/pages/Home.tsx",
      operation: "update",
      content: 'const emptyLabel = "Koi file select nahin hui";',
    })]);
  });
});
