import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenSshProvisioner } from '../OpenSshProvisioner'

describe('OpenSshProvisioner', () => {
  let provisioner: OpenSshProvisioner
  let mockSshClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    provisioner = new OpenSshProvisioner()
    mockSshClient = {
      exec: vi.fn(),
    }
  })

  // ============================================================================
  // checkOpenSsh
  // ============================================================================

  describe('checkOpenSsh', () => {
    it('returns true when OpenSSH is installed and running', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data' && cmd.includes('Get-WindowsCapability')) {
              handler(Buffer.from('Installed\n'))
            } else if (event === 'data' && cmd.includes('Get-Service')) {
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

      const result = await provisioner.checkOpenSsh(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(2)
    })

    it('returns false when OpenSSH is not installed', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('NotPresent\n'))
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

      const result = await provisioner.checkOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false when service is stopped', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data' && cmd.includes('Get-WindowsCapability')) {
              handler(Buffer.from('Installed\n'))
            } else if (event === 'data' && cmd.includes('Get-Service')) {
              handler(Buffer.from('Stopped\n'))
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

      const result = await provisioner.checkOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('handles exec errors gracefully', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(new Error('SSH connection failed'))
      })

      const result = await provisioner.checkOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('handles non-zero exit codes', async () => {
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

      const result = await provisioner.checkOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // installOpenSsh
  // ============================================================================

  describe('installOpenSsh', () => {
    it('installs OpenSSH successfully', async () => {
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

      const result = await provisioner.installOpenSsh(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Add-WindowsCapability'),
        expect.any(Function)
      )
    })

    it('returns false on installation failure', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(1), 10)
            }
            return stream
          }),
          stderr: {
            on: vi.fn((event, handler) => {
              if (event === 'data') {
                handler(Buffer.from('Installation failed\n'))
              }
              return stream
            }),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.installOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('handles exec errors gracefully', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(new Error('Permission denied'))
      })

      const result = await provisioner.installOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // enableOpenSsh
  // ============================================================================

  describe('enableOpenSsh', () => {
    it('starts and enables OpenSSH service successfully', async () => {
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

      const result = await provisioner.enableOpenSsh(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(2)
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Start-Service sshd'),
        expect.any(Function)
      )
      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('Set-Service'),
        expect.any(Function)
      )
    })

    it('returns false if service start fails', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const exitCode = callCount === 1 ? 1 : 0 // First call (Start-Service) fails
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
                handler(Buffer.from('Service start failed\n'))
              }
              return stream
            }),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.enableOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false if service enable fails', async () => {
      let callCount = 0
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callCount++
        const exitCode = callCount === 2 ? 1 : 0 // Second call (Set-Service) fails
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
                handler(Buffer.from('Service enable failed\n'))
              }
              return stream
            }),
          },
        }
        callback(null, stream)
      })

      const result = await provisioner.enableOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // verifyOpenSsh
  // ============================================================================

  describe('verifyOpenSsh', () => {
    it('returns true when service is running and automatic', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('{"Status":4,"StartType":2}\n'))
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

      const result = await provisioner.verifyOpenSsh(mockSshClient)
      expect(result).toBe(true)
    })

    it('returns false when service is not running', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('{"Status":1,"StartType":2}\n'))
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

      const result = await provisioner.verifyOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false when startup type is not automatic', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('{"Status":4,"StartType":3}\n'))
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

      const result = await provisioner.verifyOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('handles JSON parse errors', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              handler(Buffer.from('invalid json\n'))
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

      const result = await provisioner.verifyOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // ensureOpenSsh (integration)
  // ============================================================================

  describe('ensureOpenSsh', () => {
    it('returns true immediately if OpenSSH is already running', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data' && cmd.includes('Get-WindowsCapability')) {
              handler(Buffer.from('Installed\n'))
            } else if (event === 'data' && cmd.includes('Get-Service')) {
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

      const result = await provisioner.ensureOpenSsh(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec).toHaveBeenCalledTimes(2) // Only check, no install/enable
    })

    it('installs, enables, and verifies when not present', async () => {
      let checkCalled = false
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (!checkCalled && cmd.includes('Get-WindowsCapability')) {
                checkCalled = true
                handler(Buffer.from('NotPresent\n'))
              } else if (cmd.includes('ConvertTo-Json')) {
                handler(Buffer.from('{"Status":4,"StartType":2}\n'))
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

      const result = await provisioner.ensureOpenSsh(mockSshClient)
      expect(result).toBe(true)
      expect(mockSshClient.exec.mock.calls.some((call: any[]) => 
        call[0].includes('Add-WindowsCapability')
      )).toBe(true)
      expect(mockSshClient.exec.mock.calls.some((call: any[]) => 
        call[0].includes('Start-Service')
      )).toBe(true)
    })

    it('returns false if installation fails', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const exitCode = cmd.includes('Add-WindowsCapability') ? 1 : 0
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data' && cmd.includes('Get-WindowsCapability')) {
              handler(Buffer.from('NotPresent\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.ensureOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false if enable fails', async () => {
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const exitCode = cmd.includes('Start-Service') ? 1 : 0
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data' && cmd.includes('Get-WindowsCapability')) {
              handler(Buffer.from('NotPresent\n'))
            } else if (event === 'close') {
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

      const result = await provisioner.ensureOpenSsh(mockSshClient)
      expect(result).toBe(false)
    })

    it('returns false if verify fails', async () => {
      let verifyCalled = false
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        const stream = {
          on: vi.fn((event, handler) => {
            if (event === 'data') {
              if (cmd.includes('Get-WindowsCapability')) {
                handler(Buffer.from('NotPresent\n'))
              } else if (cmd.includes('ConvertTo-Json')) {
                verifyCalled = true
                handler(Buffer.from('{"Status":1,"StartType":2}\n'))
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

      const result = await provisioner.ensureOpenSsh(mockSshClient)
      expect(result).toBe(false)
      expect(verifyCalled).toBe(true)
    })
  })
})
