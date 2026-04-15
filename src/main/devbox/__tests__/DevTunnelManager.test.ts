import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DevTunnelManager } from '../DevTunnelManager'
import { EventEmitter } from 'events'

// Mock child_process
vi.mock('child_process', () => {
  return {
    spawn: vi.fn(),
    execFile: vi.fn()
  }
})

import { spawn, execFile } from 'child_process'

function createMockProcess(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
  pid: number
} {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  proc.pid = 12345
  return proc
}

describe('DevTunnelManager', () => {
  let manager: DevTunnelManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(spawn).mockReset()
    vi.mocked(execFile).mockReset()
    manager = new DevTunnelManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  describe('connect', () => {
    it('resolves when ACP port is mapped from stdout', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')

      // Simulate devtunnel output
      proc.stdout.emit('data', Buffer.from(
        'Connected to tunnel: test-tunnel\n' +
        'SSH: Forwarding from 127.0.0.1:22 to host port 22.\n' +
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))

      const ports = await connectPromise

      expect(ports.acpPort).toBe(7333)
      expect(ports.sshPort).toBe(22)
      expect(ports.allPorts.get(7333)).toBe(7333)
    })

    it('rejects on timeout', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')

      // Advance past timeout
      vi.advanceTimersByTime(31000)

      await expect(connectPromise).rejects.toThrow('timeout')
    })

    it('rejects on token expired error', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')

      // Token expired triggers stderr error matching
      proc.stderr.emit('data', Buffer.from('Login token expired.\n'))
      // Process also exits
      proc.emit('close', 3)

      await expect(connectPromise).rejects.toThrow()
    })
  })

  describe('auto-reconnect', () => {
    it('schedules reconnect when connected tunnel exits unexpectedly', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')

      // Simulate successful connection
      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))

      await connectPromise

      const reconnectingPromise = new Promise<void>((resolve) => {
        manager.on('tunnel:reconnecting', () => resolve())
      })

      // Simulate unexpected exit
      proc.emit('close', 1)

      // Should schedule reconnect
      vi.advanceTimersByTime(2000)
      await reconnectingPromise
    })

    it('does NOT reconnect when explicitly disconnected', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')

      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))

      await connectPromise

      const reconnectingSpy = vi.fn()
      manager.on('tunnel:reconnecting', reconnectingSpy)

      // Explicit disconnect
      manager.disconnect('test-tunnel')

      vi.advanceTimersByTime(120000)

      expect(reconnectingSpy).not.toHaveBeenCalled()
    })

    it('emits tunnel:disconnected with willReconnect flag', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')

      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))

      await connectPromise

      const disconnectEvents: any[] = []
      manager.on('tunnel:disconnected', (data) => disconnectEvents.push(data))

      // Unexpected exit → willReconnect: true
      proc.emit('close', 1)
      expect(disconnectEvents[0]).toEqual({ tunnelId: 'test-tunnel', willReconnect: true })
    })

    it('uses exponential backoff for reconnection delays', async () => {
      const proc1 = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc1 as any)

      const connectPromise = manager.connect('test-tunnel')
      proc1.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))
      await connectPromise

      const reconnectDelays: number[] = []
      manager.on('tunnel:reconnecting', ({ delayMs }) => reconnectDelays.push(delayMs))

      // Trigger first exit → schedules reconnect at 2s delay
      proc1.emit('close', 1)

      // First reconnect attempt
      const proc2 = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc2 as any)
      await vi.advanceTimersByTimeAsync(2100) // trigger the 2s timer
      // proc2 connect times out → exit → schedules reconnect at 4s
      await vi.advanceTimersByTimeAsync(31000)

      // Second reconnect attempt
      const proc3 = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc3 as any)
      await vi.advanceTimersByTimeAsync(4100) // trigger the 4s timer

      // We should have seen at least 2 reconnecting events
      expect(reconnectDelays.length).toBeGreaterThanOrEqual(2)
      expect(reconnectDelays[0]).toBe(2000)
      expect(reconnectDelays[1]).toBe(4000)
    })

    it('refreshes token when error was token_expired', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)
      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
        callback(null, 'Logged in as user using GitHub.\n', '')
        return {} as any
      })

      const connectPromise = manager.connect('test-tunnel')
      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))
      await connectPromise

      // Mark the error as token expired
      proc.stderr.emit('data', Buffer.from('Login token expired.\n'))
      proc.emit('close', 3)

      // Prepare a new process for reconnect
      const proc2 = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc2 as any)

      // Advance to trigger reconnect
      vi.advanceTimersByTime(2000)

      // Token refresh should have been called
      await vi.advanceTimersByTimeAsync(100)
      expect(execFile).toHaveBeenCalledWith(
        'devtunnel',
        ['user', 'login', '-g'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('gives up after max attempts and emits reconnect-failed', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')
      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))
      await connectPromise

      const failedSpy = vi.fn()
      manager.on('tunnel:reconnect-failed', failedSpy)

      // Access the internal connection and set attempts near the limit
      // @ts-expect-error - accessing private for test
      const conn = manager.connections.get('test-tunnel')!
      conn.reconnectAttempts = 19 // next attempt will be #20 (the limit)

      // Trigger exit → schedules reconnect attempt #20
      proc.emit('close', 1)

      const proc2 = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc2 as any)
      await vi.advanceTimersByTimeAsync(2100)

      // Reconnect #20 times out → close → attempt #21 > max → gives up
      await vi.advanceTimersByTimeAsync(31000)

      expect(failedSpy).toHaveBeenCalled()
      expect(failedSpy.mock.calls[0][0].reason).toBe('max_attempts_exceeded')
    })

    it('does NOT reconnect after dispose', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')
      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))
      await connectPromise

      manager.dispose()

      const reconnectingSpy = vi.fn()
      manager.on('tunnel:reconnecting', reconnectingSpy)

      proc.emit('close', 1)
      vi.advanceTimersByTime(120000)

      expect(reconnectingSpy).not.toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('clears reconnect timer on explicit disconnect', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const connectPromise = manager.connect('test-tunnel')
      proc.stdout.emit('data', Buffer.from(
        'SSH: Forwarding from 127.0.0.1:7333 to host port 7333.\n'
      ))
      await connectPromise

      expect(proc.kill).not.toHaveBeenCalled()
      manager.disconnect('test-tunnel')
      expect(proc.kill).toHaveBeenCalled()
    })
  })

  describe('checkPrerequisites', () => {
    it('detects GitHub login', async () => {
      const proc = createMockProcess()
      vi.mocked(spawn).mockReturnValue(proc as any)

      const promise = DevTunnelManager.checkPrerequisites()

      proc.stdout.emit('data', Buffer.from('Logged in as user using GitHub.\n'))
      proc.emit('close', 0)

      const result = await promise
      expect(result.available).toBe(true)
      expect(result.loggedIn).toBe(true)
      expect(result.isGitHub).toBe(true)
    })
  })
})
