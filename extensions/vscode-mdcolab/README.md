# vscode-mdcolab

A small VS Code extension that adds Markdown-sharing entry points:

- **Editor title bar** — share icon (↗, `$(export)`) appears on any open `.md` file.
- **Share submenu** — adds `Share with mdcolab…` under `Share` in both the editor and explorer context menus.
- **Command palette** — `mdcolab: Share with mdcolab…` when a Markdown file is active.

## Behavior

When invoked, the command:

1. Saves the editor buffer if dirty.
2. Checks whether the target file has **uncommitted changes** or **unpushed commits** in git.
   - If so, prompts the user. On confirm, runs `git commit --only -- <file>` (preserving any other staged changes the user has) followed by `git push`.
   - The user can also choose "Share Without Syncing" to skip the git step.
3. Reads the file, uploads to `mdcolab.endpoint` if configured (POST `{ fileName, contents }` → `{ url }`), or generates a placeholder URL otherwise.
4. Copies the resulting URL to the clipboard and surfaces a notification with an "Open Link" action.

## Build

```bash
cd extensions/vscode-mdcolab
npm install
npm run compile
```

Then press F5 from VS Code (Extension Development Host) to try it.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mdcolab.endpoint` | `""` | Upload endpoint. Empty → local stub. |
