// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ssh2 has no type definitions
import type { Client } from 'ssh2'
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { OpenSshProvisioner } from './OpenSshProvisioner'
import { AcpProvisioner } from './AcpProvisioner'

interface SshExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface DevBoxProvisioningRecord {
  devBoxName: string
  provisionedAt: number
  changes: string[]
  sessionSyncConfigured: boolean
  sshConfigured: boolean
  acpConfigured: boolean
}

interface DevBoxProvisioningState {
  version: 1
  devBoxes: Record<string, DevBoxProvisioningRecord>
}

export interface ProvisioningStep {
  step: string
  status: 'pending' | 'in-progress' | 'complete' | 'failed'
  error?: string
}

export class DevBoxProvisioner extends EventEmitter {
  private readonly stateFilePath: string
  private readonly openSshProvisioner: OpenSshProvisioner
  private readonly acpProvisioner: AcpProvisioner

  constructor(
    openSshProvisioner?: OpenSshProvisioner,
    acpProvisioner?: AcpProvisioner
  ) {
    super()
    this.stateFilePath = join(homedir(), '.tangent-2', 'devbox-state.json')
    this.openSshProvisioner = openSshProvisioner || new OpenSshProvisioner()
    this.acpProvisioner = acpProvisioner || new AcpProvisioner()
  }

  private async execCommand(sshClient: Client, command: string): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      sshClient.exec(command, (err: any, stream: any) => {
        if (err) {
          console.warn('[Tangent 2] SSH exec error:', err.message)
          reject(err)
          return
        }

        let stdout = ''
        let stderr = ''

        stream.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, exitCode: code || 0 })
        })

        stream.on('error', (streamErr: any) => {
          console.warn('[Tangent 2] SSH stream error:', streamErr.message)
          reject(streamErr)
        })
      })
    })
  }

  async isProvisioned(devBoxName: string): Promise<boolean> {
    try {
      const state = await this.loadState()
      return !!state.devBoxes[devBoxName]
    } catch (err: any) {
      console.warn('[Tangent 2] Failed to check provisioning state:', err.message)
      return false
    }
  }

  async markProvisioned(devBoxName: string, changes: string[]): Promise<void> {
    try {
      const state = await this.loadState()

      state.devBoxes[devBoxName] = {
        devBoxName,
        provisionedAt: Date.now(),
        changes,
        sessionSyncConfigured: true,
        sshConfigured: true,
        acpConfigured: true,
      }

      await this.saveState(state)
      console.log('[Tangent 2] Marked Dev Box as provisioned:', devBoxName)
    } catch (err: any) {
      console.warn('[Tangent 2] Failed to mark Dev Box as provisioned:', err.message)
    }
  }

  private async loadState(): Promise<DevBoxProvisioningState> {
    try {
      const content = await fs.readFile(this.stateFilePath, 'utf-8')
      return JSON.parse(content)
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { version: 1, devBoxes: {} }
      }
      throw err
    }
  }

  private async saveState(state: DevBoxProvisioningState): Promise<void> {
    const dir = join(homedir(), '.tangent-2')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  private async requestConsent(devBoxName: string, changes: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutMs = 300000 // 5 minutes

      const onConsentResponse = (response: { approved: boolean; devBoxName: string }) => {
        if (response.devBoxName === devBoxName) {
          clearTimeout(timeout)
          this.removeListener('provision:consent-response', onConsentResponse)
          resolve(response.approved)
        }
      }

      const timeout = setTimeout(() => {
        this.removeListener('provision:consent-response', onConsentResponse)
        console.warn('[Tangent 2] Provisioning consent timeout for Dev Box:', devBoxName)
        resolve(false)
      }, timeoutMs)

      this.on('provision:consent-response', onConsentResponse)
      this.emit('provision:consent-needed', { devBoxName, changes })
    })
  }

  private emitStep(step: string, status: ProvisioningStep['status'], error?: string): void {
    this.emit('provision:step', { step, status, error })
  }

  private async configureSessionSync(sshClient: Client): Promise<boolean> {
    try {
      const command = `powershell.exe -Command "$configPath = \\"$env:USERPROFILE\\.copilot\\config.json\\"; $config = if (Test-Path $configPath) { Get-Content $configPath | ConvertFrom-Json } else { @{} }; $config.sessionSync = @(@{ origin = \\"*\\"; level = \\"account\\" }); $config | ConvertTo-Json -Depth 10 | Set-Content $configPath"`

      const result = await this.execCommand(sshClient, command)

      if (result.exitCode !== 0) {
        console.warn('[Tangent 2] Session sync configuration failed:', result.stderr)
        return false
      }

      return true
    } catch (err: any) {
      console.warn('[Tangent 2] Session sync configuration error:', err.message)
      return false
    }
  }

  private async deploySyncHooks(sshClient: Client, workspacePath: string): Promise<boolean> {
    try {
      // Step 1: Create .github/hooks directory in workspace
      const createDirCommand = `powershell.exe -Command "New-Item -Path '${workspacePath}\\.github\\hooks' -ItemType Directory -Force"`
      const createDirResult = await this.execCommand(sshClient, createDirCommand)

      if (createDirResult.exitCode !== 0) {
        console.warn('[Tangent 2] Failed to create .github/hooks directory:', createDirResult.stderr)
        return false
      }

      // Step 2: Read template files from local assets
      const templateDir = join(process.cwd(), 'assets', 'devbox-templates')
      const syncJsonContent = await fs.readFile(join(templateDir, 'sync.json'), 'utf-8')
      const syncScriptContent = await fs.readFile(join(templateDir, 'sync-workspace-to-primary.ps1'), 'utf-8')
      const fullSyncScriptContent = await fs.readFile(join(templateDir, 'full-workspace-sync.ps1'), 'utf-8')

      // Step 3: Copy sync.json to .github/hooks/
      const syncJsonEscaped = syncJsonContent.replace(/"/g, '\\"').replace(/\n/g, '`n')
      const copySyncJsonCommand = `powershell.exe -Command "Set-Content -Path '${workspacePath}\\.github\\hooks\\sync.json' -Value \\"${syncJsonEscaped}\\" -Encoding utf8"`
      const copySyncJsonResult = await this.execCommand(sshClient, copySyncJsonCommand)

      if (copySyncJsonResult.exitCode !== 0) {
        console.warn('[Tangent 2] Failed to copy sync.json:', copySyncJsonResult.stderr)
        return false
      }

      // Step 4: Copy sync-workspace-to-primary.ps1
      const syncScriptEscaped = syncScriptContent.replace(/"/g, '\\"').replace(/\n/g, '`n')
      const copySyncScriptCommand = `powershell.exe -Command "Set-Content -Path '${workspacePath}\\.github\\hooks\\sync-workspace-to-primary.ps1' -Value \\"${syncScriptEscaped}\\" -Encoding utf8"`
      const copySyncScriptResult = await this.execCommand(sshClient, copySyncScriptCommand)

      if (copySyncScriptResult.exitCode !== 0) {
        console.warn('[Tangent 2] Failed to copy sync-workspace-to-primary.ps1:', copySyncScriptResult.stderr)
        return false
      }

      // Step 5: Copy full-workspace-sync.ps1
      const fullSyncScriptEscaped = fullSyncScriptContent.replace(/"/g, '\\"').replace(/\n/g, '`n')
      const copyFullSyncScriptCommand = `powershell.exe -Command "Set-Content -Path '${workspacePath}\\.github\\hooks\\full-workspace-sync.ps1' -Value \\"${fullSyncScriptEscaped}\\" -Encoding utf8"`
      const copyFullSyncScriptResult = await this.execCommand(sshClient, copyFullSyncScriptCommand)

      if (copyFullSyncScriptResult.exitCode !== 0) {
        console.warn('[Tangent 2] Failed to copy full-workspace-sync.ps1:', copyFullSyncScriptResult.stderr)
        return false
      }

      // Step 6: Set execute permissions (PowerShell scripts don't need chmod on Windows)
      // Verify all files exist
      const verifyCommand = `powershell.exe -Command "Test-Path '${workspacePath}\\.github\\hooks\\sync.json' -and (Test-Path '${workspacePath}\\.github\\hooks\\sync-workspace-to-primary.ps1') -and (Test-Path '${workspacePath}\\.github\\hooks\\full-workspace-sync.ps1')"`
      const verifyResult = await this.execCommand(sshClient, verifyCommand)

      if (verifyResult.stdout.trim() !== 'True') {
        console.warn('[Tangent 2] Verification failed - not all hook files deployed')
        return false
      }

      console.log('[Tangent 2] Successfully deployed sync hooks to workspace:', workspacePath)
      return true
    } catch (err: any) {
      console.warn('[Tangent 2] Failed to deploy sync hooks:', err.message)
      return false
    }
  }

  async provision(sshClient: Client, devBoxName: string, workspacePath?: string): Promise<boolean> {
    try {
      console.log('[Tangent 2] Starting provisioning for Dev Box:', devBoxName)

      // Step 1: Check if already provisioned
      const alreadyProvisioned = await this.isProvisioned(devBoxName)
      if (alreadyProvisioned) {
        console.log('[Tangent 2] Dev Box already provisioned:', devBoxName)
        this.emit('provision:complete', { devBoxName, skipped: true })
        return true
      }

      // Step 2: Request UI consent
      const changes = [
        'Install and configure OpenSSH Server',
        'Create CopilotACP scheduled task (auto-start service)',
        'Configure Copilot CLI session sync (account-level)',
        'Deploy sync hook scripts for workspace management',
      ]

      this.emitStep('request-consent', 'in-progress')
      const consentApproved = await this.requestConsent(devBoxName, changes)

      if (!consentApproved) {
        this.emitStep('request-consent', 'failed', 'User denied consent')
        this.emit('provision:failed', { devBoxName, reason: 'consent-denied' })
        return false
      }

      this.emitStep('request-consent', 'complete')

      // Step 3: Provision OpenSSH
      this.emitStep('provision-openssh', 'in-progress')
      const sshConfigured = await this.openSshProvisioner.ensureOpenSsh(sshClient)

      if (!sshConfigured) {
        this.emitStep('provision-openssh', 'failed', 'OpenSSH provisioning failed')
        this.emit('provision:failed', { devBoxName, reason: 'openssh-failed' })
        return false
      }

      this.emitStep('provision-openssh', 'complete')

      // Step 4: Provision CopilotACP service
      this.emitStep('provision-acp', 'in-progress')
      const acpConfigured = await this.acpProvisioner.ensureAcpService(sshClient)

      if (!acpConfigured) {
        this.emitStep('provision-acp', 'failed', 'CopilotACP provisioning failed')
        this.emit('provision:failed', { devBoxName, reason: 'acp-failed' })
        return false
      }

      this.emitStep('provision-acp', 'complete')

      // Step 5: Configure Copilot CLI session sync
      this.emitStep('configure-session-sync', 'in-progress')
      const sessionSyncConfigured = await this.configureSessionSync(sshClient)

      if (!sessionSyncConfigured) {
        this.emitStep('configure-session-sync', 'failed', 'Session sync configuration failed')
        this.emit('provision:failed', { devBoxName, reason: 'session-sync-failed' })
        return false
      }

      this.emitStep('configure-session-sync', 'complete')

      // Step 6: Deploy sync hook scripts
      this.emitStep('deploy-sync-hooks', 'in-progress')
      
      if (workspacePath) {
        const hooksDeployed = await this.deploySyncHooks(sshClient, workspacePath)
        
        if (!hooksDeployed) {
          this.emitStep('deploy-sync-hooks', 'failed', 'Failed to deploy sync hooks')
          this.emit('provision:failed', { devBoxName, reason: 'sync-hooks-failed' })
          return false
        }
      } else {
        console.log('[Tangent 2] No workspace path provided - skipping sync hooks deployment')
      }
      
      this.emitStep('deploy-sync-hooks', 'complete')

      // Step 7: Mark as provisioned
      this.emitStep('save-state', 'in-progress')
      await this.markProvisioned(devBoxName, changes)
      this.emitStep('save-state', 'complete')

      console.log('[Tangent 2] Provisioning complete for Dev Box:', devBoxName)
      this.emit('provision:complete', { devBoxName, skipped: false })

      return true
    } catch (err: any) {
      console.warn('[Tangent 2] Provisioning error for Dev Box:', devBoxName, err.message)
      this.emit('provision:failed', { devBoxName, reason: 'unexpected-error', error: err.message })
      return false
    }
  }
}
