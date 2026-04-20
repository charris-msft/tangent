# Tangent 2

A standalone Electron terminal app with a built-in Agents sidebar. Launch AI agents (Copilot CLI, Claude Code) from the sidebar into terminal sessions.

## Download

Pre-built installers are available on the [GitHub Releases](https://github.com/charris-msft/tangent/releases) page.

| Platform | Format |
|----------|--------|
| Windows  | `.exe` installer |
| macOS    | `.dmg` |
| Linux    | `.AppImage`, `.deb` |

## Build from Source

```bash
git clone https://github.com/charris-msft/tangent.git
cd tangent
npm install
npm run dev        # Development mode with HMR
npm run dist       # Build installer for your platform
```

## CLI

Install: `npm link` (or run `scripts/install-cli.ps1`)

Commands:
```
tangent help
tangent config get
tangent config set <key> <value>
tangent projects list
tangent projects add <name>
tangent agents list
tangent agents add <folder> --name <name> --command <cmd>
```

## Creating a Release

For maintainers — tag a version and push to trigger the CI/CD pipeline:

```bash
git tag v0.1.0
git push origin v0.1.0
# GitHub Actions will automatically build and publish installers
```
