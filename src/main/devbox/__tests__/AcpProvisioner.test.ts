import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AcpProvisioner } from '../AcpProvisioner'

describe('AcpProvisioner', () => {
  let provisioner: AcpProvisioner
  let mockSshClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    provisioner = new AcpProvisioner()
    mockSshClient = {
      exec: vi.fn(),
    }
  })

  // ============================================================================
  // checkProvisioned
  // ============================================================================

  describe('checkProvisioned', () => {
    it('returns true when CopilotACP task is in Ready state', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('Ready\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.checkProvisioned(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Get-ScheduledTask'),
        expect.any(Function)
      )
    })

    it('returns true when CopilotACP task is in Running state', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('Running\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.checkProvisioned(mockSshClient)
      expect(result).toBe(true)
    })

    it('returns false when task does not exist', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(1), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn(() => stream),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.checkProvisioned(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false when task is in Disabled state', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('Disabled\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.checkProvisioned(mockSshClient)
      expect(result).toBe(false)
    })

    it('handles exec errors gracefully', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(new Error('SSH connection failed'))
      })

      const result = await provisioner.checkProvisioned(mockSshClient)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // provisionAcpService
  // ============================================================================

  describe('provisionAcpService', () => {
    it('returns true immediately if task already exists', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('Ready\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.provisionAcpService(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(1) // Only check
    })

    it('creates and starts scheduled task successfully', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data' && callCount === 1) {
              // First call: check returns empty (not provisioned)
              handler(Buffer.from(''))
            } else if (event === 'close') {
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

      const result = await provisioner.provisionAcpService(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(3) // check, register, start
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Register-ScheduledTask'),
        expect.any(Function)
      )
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Start-ScheduledTask'),
        expect.any(Function)
      )
    })

    it('returns false if task registration fails', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const exitCode = callCount === 2 ? 1 : 0 // Register-ScheduledTask fails
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(exitCode), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn((event, handler) => {
              if (event === 'data' && exitCode !== 0) {
                handler(Buffer.from('Task registration failed\n'))
              }
              return stream
            }),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.provisionAcpService(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false if task start fails', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const exitCode = callCount === 3 ? 1 : 0 // Start-ScheduledTask fails
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(exitCode), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn((event, handler) => {
              if (event === 'data' && exitCode !== 0) {
                handler(Buffer.from('Task start failed\n'))
              }
              return stream
            }),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.provisionAcpService(mockSshClient)
      expect(result).toBe(false)
    })

    it('handles exec errors gracefully', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        if (callCount === 2) {
          callback(new Error('Permission denied'))
        } else {
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
        }
      })

      const result = await provisioner.provisionAcpService(mockSshClient)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // verifyAcpService
  // ============================================================================

  describe('verifyAcpService', () => {
    it('returns true when service responds on first attempt', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('True\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.verifyAcpService(mockSshClient, 7333)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Test-NetConnection'),
        expect.any(Function)
      )
    })

    it('retries and succeeds on third attempt', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from(callCount >= 3 ? 'True\n' : 'False\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.verifyAcpService(mockSshClient, 7333)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(3)
    }, 15000) // Longer timeout for retry delays

    it('returns false after max retries', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('False\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.verifyAcpService(mockSshClient, 7333)
      expect(result).toBe(false)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(10) // Max attempts
    }, 15000) // Longer timeout for retry delays

    it('handles exec errors gracefully', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(new Error('Network error'))
      })

      const result = await provisioner.verifyAcpService(mockSshClient, 7333)
      expect(result).toBe(false)
    })

    it('verifies on custom port', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('True\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.verifyAcpService(mockSshClient, 4000)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Port 4000'),
        expect.any(Function)
      )
    })
  })

  // ============================================================================
  // ensureAcpService (integration)
  // ============================================================================

  describe('ensureAcpService', () => {
    it('returns true immediately if service is already provisioned and responsive', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (cmd.includes('Get-ScheduledTask')) {
                handler(Buffer.from('Ready\n'))
              } else if (cmd.includes('Test-NetConnection')) {
                handler(Buffer.from('True\n'))
              }
            } else if (event === 'close') {
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

      const result = await provisioner.ensureAcpService(mockSshClient, 7333)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(2) // check + verify
    })

    it('provisions and verifies when not present', async () => {
      let checkCalled = false
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (!checkCalled && cmd.includes('Get-ScheduledTask')) {
                checkCalled = true
                handler(Buffer.from(''))
              } else if (cmd.includes('Test-NetConnection')) {
                handler(Buffer.from('True\n'))
              }
            } else if (event === 'close') {
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

      const result = await provisioner.ensureAcpService(mockSshClient, 7333)
      expect(result).toBe(true)
      expect(mockSshClient.exec.mock.calls.some((call: any[]) => 
        call[0].includes('Register-ScheduledTask')
      )).toBe(true)
      expect(mockSshClient.exec.mock.calls.some((call: any[]) => 
        call[0].includes('Start-ScheduledTask')
      )).toBe(true)
    })

    it('re-provisions if service is not responsive', async () => {
      let verifyCalls = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (cmd.includes('Get-ScheduledTask')) {
                handler(Buffer.from('Ready\n'))
              } else if (cmd.includes('Test-NetConnection')) {
                verifyCalls++
                handler(Buffer.from(verifyCalls > 10 ? 'True\n' : 'False\n'))
              }
            } else if (event === 'close') {
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

      const result = await provisioner.ensureAcpService(mockSshClient, 7333)
      expect(result).toBe(true)
      expect(mockSshClient.exec.mock.calls.some((call: any[]) => 
        call[0].includes('Register-ScheduledTask')
      )).toBe(true)
    }, 25000) // Longer timeout for multiple retries

    it('returns false if provisioning fails', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const exitCode = cmd.includes('Register-ScheduledTask') ? 1 : 0
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(exitCode), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn(() => stream),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.ensureAcpService(mockSshClient, 7333)
      expect(result).toBe(false)
    })

    it('returns false if verification fails after provisioning', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (cmd.includes('Test-NetConnection')) {
                handler(Buffer.from('False\n'))
              }
            } else if (event === 'close') {
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

      const result = await provisioner.ensureAcpService(mockSshClient, 7333)
      expect(result).toBe(false)
    }, 25000) // Longer timeout for multiple retries

    it('uses default port 7333 when not specified', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (cmd.includes('Get-ScheduledTask')) {
                handler(Buffer.from('Ready\n'))
              } else if (cmd.includes('Test-NetConnection')) {
                handler(Buffer.from('True\n'))
              }
            } else if (event === 'close') {
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

      const result = await provisioner.ensureAcpService(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Port 7333'),
        expect.any(Function)
      )
    })
  })
})
