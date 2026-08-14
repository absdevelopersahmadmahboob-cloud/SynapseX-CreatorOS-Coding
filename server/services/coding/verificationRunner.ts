import { z } from "zod";

export type VerificationCheck = "typecheck" | "lint" | "build" | "test";
export type RunnerWorkspaceFile = { path: string; content: string; language: string };

const checkSchema = z.object({
  checkType: z.enum(["typecheck", "lint", "build", "test"]),
  status: z.enum(["passed", "failed", "skipped"]),
  logText: z.string().max(300_000),
});

const runnerResponseSchema = z.object({
  checks: z.array(checkSchema).min(1),
});

export function createRunnerPayload(input: { runId: number; files: RunnerWorkspaceFile[] }) {
  return {
    runId: input.runId,
    files: input.files.map(file => ({ path: file.path, content: file.content, language: file.language })),
    checks: ["typecheck", "lint", "build", "test"] as VerificationCheck[],
  };
}

export async function executeIsolatedVerification(input: { runId: number; files: RunnerWorkspaceFile[] }) {
  const runnerUrl = process.env.CODE_RUNNER_URL;
  const runnerToken = process.env.CODE_RUNNER_TOKEN;
  if (!runnerUrl || !runnerToken) return { configured: false as const, checks: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runnerToken}`,
      },
      body: JSON.stringify(createRunnerPayload(input)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Isolated runner returned ${response.status}`);
    return { configured: true as const, ...runnerResponseSchema.parse(await response.json()) };
  } finally {
    clearTimeout(timeout);
  }
}
