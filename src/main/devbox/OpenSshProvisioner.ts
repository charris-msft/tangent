// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - ssh2 has no type definitions
import type { Client } from 'ssh2'

interface SshExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export class OpenSshProvisioner {
  private async execCommand(sshClient: Client, command: string): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      sshClient.exec(command, (err: any, stream: any) => {
        if (err) {
          console.warn('[Tangent] SSH exec error:', err.message)
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
          console.warn('[Tangent] SSH stream error:', streamErr.message)
          reject(streamErr)
        })
      })
    })
  }

  async checkOpenSsh(sshClient: Client): Promise<boolean> {
    try {
      const result = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*' | Select-Object -ExpandProperty State\""
      )

      if (result.exitCode !== 0) {
        console.warn('[Tangent] OpenSSH check failed with exit code:', result.exitCode)
        return false
      }

      const state = result.stdout.trim()
      const isInstalled = state === 'Installed'

      if (!isInstalled) {
        return false
      }

      const serviceResult = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Get-Service sshd | Select-Object -ExpandProperty Status\""
      )

      if (serviceResult.exitCode !== 0) {
        console.warn('[Tangent] OpenSSH service check failed')
        return false
      }

      const serviceStatus = serviceResult.stdout.trim()
      return serviceStatus === 'Running'
    } catch (err: any) {
      console.warn('[Tangent] OpenSSH check error:', err.message)
      return false
    }
  }

  async installOpenSsh(sshClient: Client): Promise<boolean> {
    try {
      const result = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0\""
      )

      if (result.exitCode !== 0) {
        console.warn('[Tangent] OpenSSH installation failed:', result.stderr)
        return false
      }

      return true
    } catch (err: any) {
      console.warn('[Tangent] OpenSSH installation error:', err.message)
      return false
    }
  }

  async enableOpenSsh(sshClient: Client): Promise<boolean> {
    try {
      const startResult = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Start-Service sshd\""
      )

      if (startResult.exitCode !== 0) {
        console.warn('[Tangent] OpenSSH service start failed:', startResult.stderr)
        return false
      }

      const enableResult = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Set-Service -Name sshd -StartupType 'Automatic'\""
      )

      if (enableResult.exitCode !== 0) {
        console.warn('[Tangent] OpenSSH service enable failed:', enableResult.stderr)
        return false
      }

      return true
    } catch (err: any) {
      console.warn('[Tangent] OpenSSH enable error:', err.message)
      return false
    }
  }

  async verifyOpenSsh(sshClient: Client): Promise<boolean> {
    try {
      const result = await this.execCommand(
        sshClient,
        "powershell.exe -Command \"Get-Service sshd | Select-Object Status, StartType | ConvertTo-Json\""
      )

      if (result.exitCode !== 0) {
        console.warn('[Tangent] OpenSSH verify failed')
        return false
      }

      const service = JSON.parse(result.stdout.trim())
      return service.Status === 4 && service.StartType === 2 // Status 4 = Running, StartType 2 = Automatic
    } catch (err: any) {
      console.warn('[Tangent] OpenSSH verify error:', err.message)
      return false
    }
  }

  async ensureOpenSsh(sshClient: Client): Promise<boolean> {
    const isRunning = await this.checkOpenSsh(sshClient)
    if (isRunning) {
      return true
    }

    const installed = await this.installOpenSsh(sshClient)
    if (!installed) {
      return false
    }

    const enabled = await this.enableOpenSsh(sshClient)
    if (!enabled) {
      return false
    }

    const verified = await this.verifyOpenSsh(sshClient)
    return verified
  }
}
