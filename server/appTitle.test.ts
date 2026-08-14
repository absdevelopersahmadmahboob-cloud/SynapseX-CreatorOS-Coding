import { describe, expect, it } from "vitest";

describe("application title configuration", () => {
  it("uses the SynapseX CreatorOS Coding title supplied to the runtime", () => {
    expect(process.env.VITE_APP_TITLE).toBe("SynapseX CreatorOS Coding");
  });
});
