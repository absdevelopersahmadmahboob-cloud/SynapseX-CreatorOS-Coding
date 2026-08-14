import { describe, expect, it } from "vitest";

describe("GitHub publishing credential", () => {
  it.skipIf(!process.env.GH_TOKEN)("authenticates with the configured GitHub token", async () => {
    const token = process.env.GH_TOKEN;
    if (!token) throw new Error("GH_TOKEN is required for this opt-in credential validation.");

    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    expect(response.status).toBe(200);
    const profile = await response.json() as { login?: string };
    expect(profile.login).toBeTruthy();
  });
});
