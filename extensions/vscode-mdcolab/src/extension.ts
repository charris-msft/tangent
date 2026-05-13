import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('mdcolab.share', async (resource?: vscode.Uri) => {
    const target = await resolveTarget(resource)
    if (!target) {
      vscode.window.showWarningMessage('mdcolab: no Markdown file selected.')
      return
    }

    if (path.extname(target.fsPath).toLowerCase() !== '.md') {
      vscode.window.showWarningMessage(`mdcolab: ${path.basename(target.fsPath)} is not a Markdown file.`)
      return
    }

    // Save unsaved editor buffer before anything else so disk matches what we share/commit.
    await saveIfDirty(target)

    const proceed = await ensureFileCommittedAndPushed(target)
    if (!proceed) return

    await shareWithMdcolab(target)
  })

  context.subscriptions.push(disposable)
}

export function deactivate(): void {
  /* noop */
}

async function resolveTarget(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (resource instanceof vscode.Uri) return resource
  const editor = vscode.window.activeTextEditor
  if (editor && editor.document.languageId === 'markdown') return editor.document.uri
  return undefined
}

async function saveIfDirty(uri: vscode.Uri): Promise<void> {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
  if (doc && doc.isDirty) {
    await doc.save()
  }
}

/**
 * If the target file has uncommitted changes OR unpushed commits, prompt the user
 * and (on confirm) commit just that single path and push. The rest of the index
 * (other staged changes) is preserved thanks to `git commit --only <path>`.
 *
 * Returns true if the caller should proceed with sharing, false to abort.
 */
async function ensureFileCommittedAndPushed(uri: vscode.Uri): Promise<boolean> {
  const repoRoot = await findRepoRoot(uri.fsPath)
  if (!repoRoot) return true // not a git repo — nothing to sync

  const relPath = path.relative(repoRoot, uri.fsPath).replace(/\\/g, '/')
  const fileName = path.basename(uri.fsPath)

  const [isDirty, unpushedCount] = await Promise.all([
    hasUncommittedChanges(repoRoot, relPath),
    countUnpushedCommitsForFile(repoRoot, relPath)
  ])

  if (!isDirty && unpushedCount === 0) return true

  const parts: string[] = []
  if (isDirty) parts.push('uncommitted changes')
  if (unpushedCount > 0) parts.push(`${unpushedCount} unpushed commit${unpushedCount === 1 ? '' : 's'}`)

  const message = `${fileName} has ${parts.join(' and ')}. Commit & push just this file before sharing?`
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail: 'Other staged changes will be left untouched.' },
    'Commit & Push',
    'Share Without Syncing'
  )

  if (choice === undefined) return false // user dismissed

  if (choice === 'Share Without Syncing') {
    return true
  }

  // Commit only this path (preserves the rest of the user's index) and push.
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Committing ${fileName}…`,
        cancellable: false
      },
      async (progress) => {
        if (isDirty) {
          const commitMsg = `Share ${fileName} via mdcolab`
          // --only + pathspec: snapshot HEAD + changes to this path only.
          // Other staged/working changes are untouched.
          await gitRun(repoRoot, ['commit', '--only', '-m', commitMsg, '--', relPath])
        }
        progress.report({ message: 'Pushing…' })
        await gitRun(repoRoot, ['push'])
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const again = await vscode.window.showErrorMessage(
      `mdcolab: git commit/push failed: ${msg}`,
      'Share Anyway',
      'Cancel'
    )
    return again === 'Share Anyway'
  }

  return true
}

async function findRepoRoot(startPath: string): Promise<string | undefined> {
  try {
    const cwd = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath)
    const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function hasUncommittedChanges(repoRoot: string, relPath: string): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain', '--', relPath], { cwd: repoRoot })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function countUnpushedCommitsForFile(repoRoot: string, relPath: string): Promise<number> {
  try {
    // If there's no upstream, this throws; treat as 0.
    const { stdout } = await exec('git', ['rev-list', '--count', '@{u}..HEAD', '--', relPath], { cwd: repoRoot })
    const n = parseInt(stdout.trim(), 10)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

async function gitRun(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
    return stdout
  } catch (err: any) {
    const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : ''
    throw new Error(stderr || err?.message || `git ${args.join(' ')} failed`)
  }
}

async function shareWithMdcolab(uri: vscode.Uri): Promise<void> {
  const endpoint = vscode.workspace.getConfiguration('mdcolab').get<string>('endpoint', '').trim()
  const fileName = path.basename(uri.fsPath)

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Sharing ${fileName} with mdcolab…`,
      cancellable: false
    },
    async () => {
      let contents: string
      try {
        contents = await fs.promises.readFile(uri.fsPath, 'utf8')
      } catch (err) {
        vscode.window.showErrorMessage(`mdcolab: failed to read ${fileName}: ${String(err)}`)
        return
      }

      const shareUrl = endpoint
        ? await uploadToEndpoint(endpoint, fileName, contents)
        : buildStubShareUrl(fileName)

      if (!shareUrl) return

      await vscode.env.clipboard.writeText(shareUrl)
      const action = await vscode.window.showInformationMessage(
        `mdcolab: share link for ${fileName} copied to clipboard.`,
        'Open Link'
      )
      if (action === 'Open Link') {
        await vscode.env.openExternal(vscode.Uri.parse(shareUrl))
      }
    }
  )
}

async function uploadToEndpoint(endpoint: string, fileName: string, contents: string): Promise<string | undefined> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, contents })
    })
    if (!res.ok) {
      vscode.window.showErrorMessage(`mdcolab: upload failed (${res.status} ${res.statusText}).`)
      return undefined
    }
    const body = (await res.json()) as { url?: string }
    if (!body.url) {
      vscode.window.showErrorMessage('mdcolab: upload response did not include a URL.')
      return undefined
    }
    return body.url
  } catch (err) {
    vscode.window.showErrorMessage(`mdcolab: upload error: ${String(err)}`)
    return undefined
  }
}

function buildStubShareUrl(fileName: string): string {
  const slug = encodeURIComponent(fileName.replace(/\.md$/i, ''))
  return `https://mdcolab.example/local/${slug}`
}
