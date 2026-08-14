# Isolated Verification Runner Contract

SynapseX CreatorOS Coding must not run arbitrary workspace code inside its web-server process. A project can contain any programming language, package, toolchain, or task, so verification needs a disposable isolated runner.

## Required request contract

The application sends a short-lived, authenticated request to a runner with the following data:

```json
{
  "runId": 42,
  "files": [{ "path": "src/app.ts", "content": "...", "language": "typescript" }],
  "checks": ["typecheck", "lint", "build", "test"],
  "timeoutSeconds": 600
}
```

The runner must materialize the supplied project inside a fresh sandbox, select project-appropriate commands, persist returned logs, and return each check's `passed`, `failed`, or `skipped` state. It must have no persistent filesystem, no access to application database credentials, and no outbound network access while it executes untrusted source.

## Included runner

This repository contains an executable runner under [`runner/`](../../runner). It is a separate Node process meant to run in a disposable Docker container. The web application sends accepted workspace files to the runner only when `CODE_RUNNER_URL` and `CODE_RUNNER_TOKEN` are configured. The returned logs and final check states are stored in `verification_runs`; no check is marked passed without a successful response.

## GitHub Actions option

For GitHub-connected projects, configure the workflow in `.github/workflows/verify.yml`. The user approves the repository push; GitHub then executes checks in a disposable runner and publishes logs to the repository. This is suitable for common repositories but is not a substitute for a dedicated sandbox service where command selection must be fully dynamic.

## Production rule

Never mark a check as passed until an isolated runner has returned a successful result. Until then SynapseX CreatorOS Coding keeps verification in the `queued` state and shows the recorded runner log.
