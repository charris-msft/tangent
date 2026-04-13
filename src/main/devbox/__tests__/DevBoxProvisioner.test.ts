import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DevBoxProvisioner } from '../DevBoxProvisioner'
import { OpenSshProvisioner } from '../OpenSshProvisioner'
import { AcpProvisioner } from '../AcpProvisioner'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

vi.mock('fs')

describe('DevBoxProvisioner', () => {
  let provisioner: DevBoxProvisioner
  let mockSshClient: any
  let mockOpenSshProvisioner: any
  let mockAcpProvisioner: any
  const testDevBoxName = 'test-devbox-1'
  const stateFilePath = join(homedir(), '.tangent', 'devbox-state.json')

  beforeEach(() => {
    vi.clearAllMocks()

    mockSshClient = {
      exec: vi.fn(),
    }

    mockOpenSshProvisioner = {
      ensureOpenSsh: vi.fn(),
    }

    mockAcpProvisioner = {
      ensureAcpService: vi.fn(),
    }

    provisioner = new DevBoxProvisioner(mockOpenSshProvisioner, mockAcpProvisioner)
  })

  afterEach(() => {
    provisioner.removeAllListeners()
  })

  // ============================================================================
  // isProvisioned
  // ============================================================================

  describe('isProvisioned', () => {
    it('returns true when Dev Box is provisioned', async () => {
      const mockState = {
        version: 1,
        devBoxes: {
          [testDevBoxName]: {
            devBoxName: testDevBoxName,
            provisionedAt: Date.now(),
            changes: ['test change'],
            sessionSyncConfigured: true,
            sshConfigured: true,
            acpConfigured: true,
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState))

      const result = await provisioner.isProvisioned(testDevBoxName)
      expect(result).toBe(true)
    })

    it('returns false when Dev Box is not provisioned', async () => {
      const mockState = {
        version: 1,
        devBoxes: {},
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState))

      const result = await provisioner.isProvisioned(testDevBoxName)
      expect(result).toBe(false)
    })

    it('returns false when state file does not exist', async () => {
      const error: any = new Error('File not found')
      error.code = 'ENOENT'
      vi.mocked(fs.readFile).mockRejectedValue(error)

      const result = await provisioner.isProvisioned(testDevBoxName)
      expect(result).toBe(false)
    })

    it('returns false on read error', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'))

      const result = await provisioner.isProvisioned(testDevBoxName)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // markProvisioned
  // ============================================================================

  describe('markProvisioned', () => {
    it('saves provisioning record to state file', async () => {
      const mockState = {
        version: 1,
        devBoxes: {},
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState))
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const changes = ['OpenSSH configured', 'ACP service running']
      await provisioner.markProvisioned(testDevBoxName, changes)

      expect(fs.mkdir).toHaveBeenCalledWith(join(homedir(), '.tangent'), { recursive: true })
      expect(fs.writeFile).toHaveBeenCalledWith(
        stateFilePath,
        expect.stringContaining(testDevBoxName),
        'utf-8'
      )

      const savedContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string
      const savedState = JSON.parse(savedContent)

      expect(savedState.devBoxes[testDevBoxName]).toMatchObject({
        devBoxName: testDevBoxName,
        changes,
        sessionSyncConfigured: true,
        sshConfigured: true,
        acpConfigured: true,
      })
      expect(savedState.devBoxes[testDevBoxName].provisionedAt).toBeGreaterThan(0)
    })

    it('appends to existing state', async () => {
      const existingDevBox = 'existing-devbox'
      const mockState = {
        version: 1,
        devBoxes: {
          [existingDevBox]: {
            devBoxName: existingDevBox,
            provisionedAt: Date.now() - 10000,
            changes: ['old change'],
            sessionSyncConfigured: true,
            sshConfigured: true,
            acpConfigured: true,
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState))
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const changes = ['new change']
      await provisioner.markProvisioned(testDevBoxName, changes)

      const savedContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string
      const savedState = JSON.parse(savedContent)

      expect(savedState.devBoxes[existingDevBox]).toBeDefined()
      expect(savedState.devBoxes[testDevBoxName]).toBeDefined()
      expect(Object.keys(savedState.devBoxes)).toHaveLength(2)
    })

    it('handles save errors gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Write error'))

      await expect(provisioner.markProvisioned(testDevBoxName, [])).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // provision (integration flow)
  // ============================================================================

  describe('provision', () => {
    it('skips provisioning if already provisioned', async () => {
      const mockState = {
        version: 1,
        devBoxes: {
          [testDevBoxName]: {
            devBoxName: testDevBoxName,
            provisionedAt: Date.now(),
            changes: [],
            sessionSyncConfigured: true,
            sshConfigured: true,
            acpConfigured: true,
          },
        },
      }

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState))

      const completeListener = vi.fn()
      provisioner.on('provision:complete', completeListener)

      const result = await provisioner.provision(mockSshClient, testDevBoxName)

      expect(result).toBe(true)
      expect(completeListener).toHaveBeenCalledWith({ devBoxName: testDevBoxName, skipped: true })
      expect(mockOpenSshProvisioner.ensureOpenSsh).not.toHaveBeenCalled()
      expect(mockAcpProvisioner.ensureAcpService).not.toHaveBeenCalled()
    })

    it('requests consent before provisioning', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))

      const consentListener = vi.fn()
      provisioner.on('provision:consent-needed', consentListener)

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(consentListener).toHaveBeenCalledWith({
        devBoxName: testDevBoxName,
        changes: expect.arrayContaining([
          expect.stringContaining('OpenSSH'),
          expect.stringContaining('CopilotACP'),
          expect.stringContaining('session sync'),
          expect.stringContaining('sync hook'),
        ]),
      })

      provisioner.emit('provision:consent-response', {
        approved: false,
        devBoxName: testDevBoxName,
      })

      const result = await provisionPromise
      expect(result).toBe(false)
    })

    it('completes full provisioning flow on consent approval', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      mockOpenSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      mockAcpProvisioner.ensureAcpService.mockResolvedValue(true)

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(0), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn(() => stream),
          },
        }
        callback(null, stream)
      })

      const stepListener = vi.fn()
      const completeListener = vi.fn()
      provisioner.on('provision:step', stepListener)
      provisioner.on('provision:complete', completeListener)

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      provisioner.emit('provision:consent-response', {
        approved: true,
        devBoxName: testDevBoxName,
      })

      const result = await provisionPromise

      expect(result).toBe(true)
      expect(mockOpenSshProvisioner.ensureOpenSsh).toHaveBeenCalledWith(mockSshClient)
      expect(mockAcpProvisioner.ensureAcpService).toHaveBeenCalledWith(mockSshClient)

      expect(stepListener).toHaveBeenCalledWith({
        step: 'request-consent',
        status: 'complete',
      })
      expect(stepListener).toHaveBeenCalledWith({
        step: 'provision-openssh',
        status: 'complete',
      })
      expect(stepListener).toHaveBeenCalledWith({
        step: 'provision-acp',
        status: 'complete',
      })
      expect(stepListener).toHaveBeenCalledWith({
        step: 'configure-session-sync',
        status: 'complete',
      })
      expect(stepListener).toHaveBeenCalledWith({
        step: 'deploy-sync-hooks',
        status: 'complete',
      })
      expect(stepListener).toHaveBeenCalledWith({
        step: 'save-state',
        status: 'complete',
      })

      expect(completeListener).toHaveBeenCalledWith({
        devBoxName: testDevBoxName,
        skipped: false,
      })

      expect(fs.writeFile).toHaveBeenCalled()
    })

    it('fails if OpenSSH provisioning fails', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      mockOpenSshProvisioner.ensureOpenSsh.mockResolvedValue(false)

      const failedListener = vi.fn()
      const stepListener = vi.fn()
      provisioner.on('provision:failed', failedListener)
      provisioner.on('provision:step', stepListener)

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      provisioner.emit('provision:consent-response', {
        approved: true,
        devBoxName: testDevBoxName,
      })

      const result = await provisionPromise

      expect(result).toBe(false)
      expect(stepListener).toHaveBeenCalledWith({
        step: 'provision-openssh',
        status: 'failed',
        error: 'OpenSSH provisioning failed',
      })
      expect(failedListener).toHaveBeenCalledWith({
        devBoxName: testDevBoxName,
        reason: 'openssh-failed',
      })
      expect(mockAcpProvisioner.ensureAcpService).not.toHaveBeenCalled()
    })

    it('fails if ACP provisioning fails', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      mockOpenSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      mockAcpProvisioner.ensureAcpService.mockResolvedValue(false)

      const failedListener = vi.fn()
      const stepListener = vi.fn()
      provisioner.on('provision:failed', failedListener)
      provisioner.on('provision:step', stepListener)

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      provisioner.emit('provision:consent-response', {
        approved: true,
        devBoxName: testDevBoxName,
      })

      const result = await provisionPromise

      expect(result).toBe(false)
      expect(stepListener).toHaveBeenCalledWith({
        step: 'provision-acp',
        status: 'failed',
        error: 'CopilotACP provisioning failed',
      })
      expect(failedListener).toHaveBeenCalledWith({
        devBoxName: testDevBoxName,
        reason: 'acp-failed',
      })
    })

    it('fails if session sync configuration fails', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      mockOpenSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      mockAcpProvisioner.ensureAcpService.mockResolvedValue(true)

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(1), 10) // Non-zero exit code
            }
            return stream
          }),
          stderr: {
            on: vi.fn((event, handler) => {
              if (event === 'data') {
                handler(Buffer.from('Config error\n'))
              }
              return stream
            }),
          },
        }
        callback(null, stream)
      })

      const failedListener = vi.fn()
      const stepListener = vi.fn()
      provisioner.on('provision:failed', failedListener)
      provisioner.on('provision:step', stepListener)

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      provisioner.emit('provision:consent-response', {
        approved: true,
        devBoxName: testDevBoxName,
      })

      const result = await provisionPromise

      expect(result).toBe(false)
      expect(stepListener).toHaveBeenCalledWith({
        step: 'configure-session-sync',
        status: 'failed',
        error: 'Session sync configuration failed',
      })
      expect(failedListener).toHaveBeenCalledWith({
        devBoxName: testDevBoxName,
        reason: 'session-sync-failed',
      })
    })

    it('emits all step events during successful provisioning', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      mockOpenSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      mockAcpProvisioner.ensureAcpService.mockResolvedValue(true)

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(0), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn(() => stream),
          },
        }
        callback(null, stream)
      })

      const stepListener = vi.fn()
      provisioner.on('provision:step', stepListener)

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      provisioner.emit('provision:consent-response', {
        approved: true,
        devBoxName: testDevBoxName,
      })

      await provisionPromise

      const expectedSteps = [
        'request-consent',
        'provision-openssh',
        'provision-acp',
        'configure-session-sync',
        'deploy-sync-hooks',
        'save-state',
      ]

      for (const step of expectedSteps) {
        expect(stepListener).toHaveBeenCalledWith({
          step,
          status: 'in-progress',
        })
        expect(stepListener).toHaveBeenCalledWith({
          step,
          status: 'complete',
        })
      }
    })

    it('handles consent timeout (defaults to denial)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))

      const failedListener = vi.fn()
      provisioner.on('provision:failed', failedListener)

      vi.useFakeTimers()

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await vi.advanceTimersByTimeAsync(300000) // 5 minutes

      const result = await provisionPromise

      expect(result).toBe(false)
      expect(failedListener).toHaveBeenCalledWith({
        devBoxName: testDevBoxName,
        reason: 'consent-denied',
      })

      vi.useRealTimers()
    })

    it('configures session sync with correct PowerShell command', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 1, devBoxes: {} }))
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      mockOpenSshProvisioner.ensureOpenSsh.mockResolvedValue(true)
      mockAcpProvisioner.ensureAcpService.mockResolvedValue(true)

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(0), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn(() => stream),
          },
        }
        callback(null, stream)
      })

      const provisionPromise = provisioner.provision(mockSshClient, testDevBoxName)

      await new Promise((resolve) => setTimeout(resolve, 50))

      provisioner.emit('provision:consent-response', {
        approved: true,
        devBoxName: testDevBoxName,
      })

      await provisionPromise

      const sessionSyncCall = mockSshClient.exec.mock.calls.find((call: any[]) =>
        call[0].includes('sessionSync')
      )

      expect(sessionSyncCall).toBeDefined()
      expect(sessionSyncCall[0]).toContain('$env:USERPROFILE\\.copilot\\config.json')
      expect(sessionSyncCall[0]).toContain('origin = \\"*\\"')
      expect(sessionSyncCall[0]).toContain('level = \\"account\\"')
      expect(sessionSyncCall[0]).toContain('ConvertTo-Json -Depth 10')
    })
  })
})
