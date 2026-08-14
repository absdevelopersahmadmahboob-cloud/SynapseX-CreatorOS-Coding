# Isolated Verification Runner Contract

CodeForge must not run arbitrary workspace code inside its web-server process. A project can contain any programming language, package, toolchain, or task, so verification needs a disposable isolated runner.

## Required request contract

The application should send a short-lived, authenticated request to a runner with the following data:

```json
{
  "runId": 42,
  "projectArchive": "signed-storage-url-or-archive-key",
  "checks": ["typecheck", "lint", "build", "test"],
  "timeoutSeconds": 600
}
```

The runner must clone or unpack the project inside a fresh sandbox, select project-appropriate commands, stream or persist logs, and return each check's `queued`, `running`, `passed`, `failed`, or `skipped` state. It must have no persistent filesystem, no access to application database credentials, and only scoped outbound network access.

## GitHub Actions option

For GitHub-connected projects, configure the workflow in `.github/workflows/verify.yml`. The user approves the repository push; GitHub then executes checks in a disposable runner and publishes logs to the repository. This is suitable for common repositories but is not a substitute for a dedicated sandbox service where command selection must be fully dynamic.

## Production rule

Never mark a check as passed until an isolated runner has returned a successful result. Until then CodeForge keeps verification in the `queued` state and shows the recorded runner log.

