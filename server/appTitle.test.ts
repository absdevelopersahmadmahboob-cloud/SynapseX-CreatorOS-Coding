import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application title configuration", () => {
  it("uses the SynapseX CreatorOS Coding browser title without requiring deployment environment values", () => {
    const html = readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
    expect(html).toContain("<title>SynapseX CreatorOS Coding</title>");
  });
});
