# Setup and Environment Configuration

SynapseX CreatorOS Coding is deployed with platform-managed configuration. Configure environment values through your hosting provider or project settings; do not commit a local environment file containing credentials.

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Persistent metadata database connection | Yes |
| `JWT_SECRET` | Session signing secret | Yes |
| `BUILT_IN_FORGE_API_URL` | Built-in platform API endpoint | Yes on Manus |
| `BUILT_IN_FORGE_API_KEY` | Server-side platform API credential | Yes on Manus |
| `VITE_APP_ID` | OAuth application identifier | Yes |
| `OAUTH_SERVER_URL` | OAuth backend endpoint | Yes |
| `VITE_OAUTH_PORTAL_URL` | OAuth portal endpoint | Yes |
| `CODE_RUNNER_URL` | Optional isolated verification-runner endpoint | Required before real user-code execution |
| `CODE_RUNNER_TOKEN` | Optional short-lived runner authentication token | Required with `CODE_RUNNER_URL` |
| `SYNAPSEX_GITHUB_REPOSITORY` | GitHub repository in `owner/repository` format | Required for repository publishing |

For a local or alternate deployment, substitute equivalents for authentication, object storage, database access, and the language-model provider. Never expose server-side keys in browser code.
