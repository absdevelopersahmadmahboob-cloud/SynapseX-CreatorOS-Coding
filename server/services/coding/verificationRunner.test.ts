import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunnerPayload, executeIsolatedVerification } from "./verificationRunner";

describe("isolated verification runner payload", () => {
  it("preserves complete workspace files and the standard verification sequence", () => {
    const payload = createRunnerPayload({
      runId: 44,
      files: [{ path: "src/app.ts", content: "export const ready = true;", language: "typescript" }],
    });

    expect(payload).toEqual({
      runId: 44,
      files: [{ path: "src/app.ts", content: "export const ready = true;", language: "typescript" }],
      checks: ["typecheck", "lint", "build", "test"],
    });
  });

  it("returns persisted runner check logs when an isolated runner is configured", async () => {
    const previousUrl = process.env.CODE_RUNNER_URL;
    const previousToken = process.env.CODE_RUNNER_TOKEN;
    process.env.CODE_RUNNER_URL = "https://runner.example.test/";
    process.env.CODE_RUNNER_TOKEN = "private-runner-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checks: [{ checkType: "typecheck", status: "failed", logText: "src/app.ts(5,2): error" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeIsolatedVerification({ runId: 45, files: [] });

    expect(result).toEqual({ configured: true, checks: [{ checkType: "typecheck", status: "failed", logText: "src/app.ts(5,2): error" }] });
    expect(fetchMock).toHaveBeenCalledWith("https://runner.example.test/execute", expect.objectContaining({ method: "POST" }));
    process.env.CODE_RUNNER_URL = previousUrl;
    process.env.CODE_RUNNER_TOKEN = previousToken;
  });
});

afterEach(() => vi.unstubAllGlobals());
