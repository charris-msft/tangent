// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ssh2 has no type definitions
import type { Client } from 'ssh2'
import { Socket, createConnection } from 'net'

interface SshExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export class AcpProvisioner {
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

  async checkProvisioned(sshClient: Client): Promise<boolean> {
    try {
      const result = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Get-ScheduledTask -TaskName 'CopilotACP' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty State\""
      )

      if (result.exitCode !== 0) {
        return false
      }

      const state = result.stdout.trim()
      return state === 'Ready' || state === 'Running'
    } catch (err: any) {
      console.warn('[Tangent 2] ACP provisioning check error:', err.message)
      return false
    }
  }

  async provisionAcpService(sshClient: Client, force = false): Promise<boolean> {
    try {
      if (!force) {
        const isProvisioned = await this.checkProvisioned(sshClient)
        if (isProvisioned) {
          console.log('[Tangent 2] CopilotACP task already exists')
          return true
        }
      }

      const command = `powershell.exe -Command "$action = New-ScheduledTaskAction -Execute 'copilot' -Argument '--acp --port 3000 --allow-all-tools'; $trigger = New-ScheduledTaskTrigger -AtLogOn; $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1); Register-ScheduledTask -TaskName 'CopilotACP' -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null"`

      const result = await this.execCommand(sshClient, command)

      if (result.exitCode !== 0) {
        console.warn('[Tangent 2] ACP provisioning failed:', result.stderr)
        return false
      }

      const startResult = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Start-ScheduledTask -TaskName 'CopilotACP'\""
      )

      if (startResult.exitCode !== 0) {
        console.warn('[Tangent 2] ACP task start failed:', startResult.stderr)
        return false
      }

      return true
    } catch (err: any) {
      console.warn('[Tangent 2] ACP provisioning error:', err.message)
      return false
    }
  }

  async verifyAcpService(sshClient: Client, port: number): Promise<boolean> {
    try {
      const maxAttempts = 10
      const delayMs = 1000

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await this.execCommand(
          sshClient,
          `powershell.exe -Command "Test-NetConnection -ComputerName 127.0.0.1 -Port ${port} -InformationLevel Quiet"`
        )

        if (result.exitCode === 0) {
          const canConnect = result.stdout.trim() === 'True'
          if (canConnect) {
            console.log(`[Tangent 2] ACP service verified on port ${port}`)
            return true
          }
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }

      console.warn(`[Tangent 2] ACP service verification failed after ${maxAttempts} attempts`)
      return false
    } catch (err: any) {
      console.warn('[Tangent 2] ACP service verification error:', err.message)
      return false
    }
  }

  async ensureAcpService(sshClient: Client, port = 3000): Promise<boolean> {
    const isProvisioned = await this.checkProvisioned(sshClient)
    if (isProvisioned) {
      const isResponsive = await this.verifyAcpService(sshClient, port)
      if (isResponsive) {
        return true
      }
    }

    const provisioned = await this.provisionAcpService(sshClient, isProvisioned)
    if (!provisioned) {
      return false
    }

    const verified = await this.verifyAcpService(sshClient, port)
    return verified
  }
}
