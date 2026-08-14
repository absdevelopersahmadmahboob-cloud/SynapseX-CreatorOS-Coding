# SynapseX Isolated Verification Runner

This standalone process receives a temporary workspace payload, writes it only inside an ephemeral directory, prepares dependencies with `pnpm install --frozen-lockfile --ignore-scripts` when needed, executes compatible `package.json` verification scripts without a shell, returns capped logs, and deletes the directory after every request.

It is intentionally separate from the SynapseX CreatorOS Coding web server. Run it in a disposable container with no repository mount, no application credentials, and a private random `RUNNER_TOKEN`. Dependency installation needs access only to a trusted package registry; disable outbound network before verification scripts run, or use a pre-warmed internal package mirror.

```bash
docker build -t synapsex-verification-runner ./runner
docker run --rm --read-only --tmpfs /tmp --network none \
  -p 8787:8787 \
  -e RUNNER_TOKEN='use-a-long-random-secret' \
  synapsex-verification-runner
```

Set the web application's `CODE_RUNNER_URL` to the runner's private URL and set `CODE_RUNNER_TOKEN` to the same secret. The web application then sends accepted workspaces to `POST /execute`; it never executes user source inside its own application process.

The bundled runner detects `typecheck`/`check`, `lint`, `build`, and `test` scripts declared in `package.json`. A missing script is reported as `skipped`, never as `passed`. Workspaces with dependencies must include a committed `pnpm-lock.yaml`; otherwise dependency preparation fails rather than installing an uncontrolled dependency set.
