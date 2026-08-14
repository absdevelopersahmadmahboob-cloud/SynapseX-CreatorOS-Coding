# SynapseX CreatorOS Coding

SynapseX CreatorOS Coding is a controlled, universal coding-assistant platform. It accepts development tasks in any natural language, interprets the complete request before planning work, and always writes assistant-facing explanations in Roman Urdu.

## What it does

- Understands coding requests across web applications, APIs, scripts, automation, mobile apps, debugging, refactoring, documentation, and infrastructure.
- Uses full-prompt semantic interpretation instead of isolated keyword routing.
- Creates project workspaces with editable files, code proposals, line-level diffs, review gates, snapshots, and rollback.
- Requires explicit approval before irreversible operations such as file deletion, live pushes, or permanent actions.
- Keeps source-file and snapshot bytes in object storage; the database stores project metadata and change records.

## Local setup

```bash
pnpm install
pnpm drizzle-kit generate
pnpm dev
```

Set the values required by your hosting provider through its environment configuration. Never commit real credentials or a local environment file.

## Testing

```bash
pnpm check
pnpm test
pnpm build
```

## Verification execution

SynapseX CreatorOS Coding records and displays type-check, lint, build, and test jobs after a reviewed change set is accepted. Actual arbitrary-code execution must run in an isolated runner, never inside the application server. See [`docs/EXECUTION-RUNNER.md`](docs/EXECUTION-RUNNER.md) for the runner contract and GitHub Actions example.

Runner ki zarurat, optionality, zero-extra-server launch flow aur Roman Urdu setup ke liye [`docs/RUNNER-GUIDE-ROMAN-URDU.md`](docs/RUNNER-GUIDE-ROMAN-URDU.md) dekhein.

See [`docs/SETUP.md`](docs/SETUP.md) for the environment-variable reference.

## Deployment

This repository is a Node application. Deploy it to a platform that provides a database, object storage access, and a separate sandboxed execution service for user project verification. Production deployment, repository pushes, and permanent destructive actions must remain user-approved operations.
