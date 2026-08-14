import { describe, expect, it } from "vitest";
import { assertSelfImprovementChanges, isAllowedSelfImprovementPath } from "./selfImprovement";

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
});
