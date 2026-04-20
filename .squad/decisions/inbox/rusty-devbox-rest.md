# Decision: DevBoxManager REST API Architecture

**Date:** 2025-07-18
**Author:** Rusty (Backend Dev)
**Status:** Implemented

## Context

DevBoxManager had stub methods and depended on `@microsoft/devbox-mcp` — a package that was never available at runtime. All methods returned empty/false/null.

## Decision

Replace MCP client approach with direct Azure Dev Center **data-plane REST API** calls using:

1. **`@azure/identity` DefaultAzureCredential** — portable auth (az login, env vars, managed identity)
2. **Native `fetch`** — no axios dependency, available in Electron/Node 18+
3. **Config file** at `~/.tangent/devbox-config.json` — keeps endpoint + project out of code

## API Surface

| Method | REST Call |
|--------|-----------|
| listDevBoxes | `GET /projects/{project}/users/me/devboxes` |
| getDevBox | `GET /projects/{project}/users/me/devboxes/{name}` |
| startDevBox | `POST .../devboxes/{name}:start` |
| stopDevBox | `POST .../devboxes/{name}:stop` |
| getConnectionInfo | `GET .../devboxes/{name}/remoteConnection` |

All calls use `api-version=2024-02-01` and Bearer token with scope `https://devcenter.azure.com/.default`.

## Alternatives Considered

- **@microsoft/devbox-mcp**: Not publicly available, required MCP server as child process
- **@azure/arm-devcenter**: Management plane only — cannot list user's dev boxes
- **Azure CLI wrapper**: Too slow, not portable

## Consequences

- Users must create `~/.tangent/devbox-config.json` before Dev Box features work
- Missing config degrades gracefully (empty arrays, no crashes)
- DevBoxPicker UI now shows setup instructions when unconfigured
- 18 unit tests validate all REST paths including error handling
