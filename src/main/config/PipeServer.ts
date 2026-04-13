import { createServer, type Server, type Socket } from 'net'
import { platform } from 'os'
import { unlinkSync } from 'fs'
import { v4 as uuid } from 'uuid'
import type { BrowserWindow } from 'electron'
import type { ConfigStore } from './ConfigStore'
import type { AgentStore } from '../agents/AgentStore'
import type { AgentProfile } from '@shared/types'

const PIPE_PATH =
  platform() === 'win32'
    ? '\\\\.\\pipe\\tangent-config'
    : '/tmp/tangent-config.sock'

interface RpcRequest {
  method: string
  params?: Record<string, unknown>
}

interface RpcResponse {
  result?: unknown
  error?: string
}

/** Strip emoji and variation selectors so "🏗️Demos" normalises to "Demos". */
function stripEmoji(s: string): string {
  return s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim()
}

/** Find a folder by exact name first, then by emoji-stripped case-insensitive match. */
function findFolder<T extends { name: string }>(folders: T[], name: string): T | undefined {
  const exact = folders.find((f) => f.name === name)
  if (exact) return exact
  const stripped = stripEmoji(name).toLowerCase()
  return folders.find((f) => stripEmoji(f.name).toLowerCase() === stripped)
}

export class PipeServer {
  private server: Server | null = null
  private readonly configStore: ConfigStore
  private readonly agentStore: AgentStore
  private readonly getWindow: () => BrowserWindow | null

  constructor(
    configStore: ConfigStore,
    agentStore: AgentStore,
    getWindow: () => BrowserWindow | null
  ) {
    this.configStore = configStore
    this.agentStore = agentStore
    this.getWindow = getWindow
  }

  start(): void {
    // Clean up stale socket on Unix
    if (platform() !== 'win32') {
      try {
        unlinkSync(PIPE_PATH)
      } catch {
        // ignore
      }
    }

    this.server = createServer((socket: Socket) => {
      let buffer = ''
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          if (line.length > 0) {
            this.handleMessage(line, socket)
          }
        }
      })
      socket.on('error', (err) => {
        console.warn('[PipeServer] Socket error:', err.message)
      })
    })

    this.server.on('error', (err) => {
      console.error('[PipeServer] Server error:', err.message)
    })

    this.server.listen(PIPE_PATH, () => {
      console.log(`[PipeServer] Listening on ${PIPE_PATH}`)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (platform() !== 'win32') {
      try {
        unlinkSync(PIPE_PATH)
      } catch {
        // ignore
      }
    }
  }

  private handleMessage(line: string, socket: Socket): void {
    let request: RpcRequest
    try {
      request = JSON.parse(line)
    } catch {
      this.send(socket, { error: 'Invalid JSON' })
      return
    }

    const response = this.dispatch(request)
    this.send(socket, response)
  }

  private dispatch(request: RpcRequest): RpcResponse {
    switch (request.method) {
      case 'config.get':
        return { result: this.configStore.getAll() }

      case 'config.set': {
        const key = request.params?.key as string | undefined
        const value = request.params?.value
        if (!key) return { error: 'Missing "key" param' }
        this.configStore.set(key, value)
        return { result: 'ok' }
      }

      case 'agents.list':
        return { result: this.agentStore.getGroups() }

      case 'agents.add': {
        const folderName = request.params?.folder as string | undefined
        const agentData = request.params?.agent as Partial<AgentProfile> | undefined
        if (!folderName || !agentData?.name || !agentData?.command) {
          return { error: 'Missing "folder", "agent.name", or "agent.command" param' }
        }
        const folders = this.agentStore.getGroups()
        const folder = findFolder(folders, folderName)
        if (!folder) {
          return { error: `Folder "${folderName}" not found` }
        }
        const newAgent: AgentProfile = {
          id: uuid(),
          name: agentData.name,
          command: agentData.command,
          args: agentData.args ?? [],
          cwdMode: agentData.cwdMode ?? 'activeSession',
          launchTarget: agentData.launchTarget ?? 'currentTab'
        }
        folder.agents.push(newAgent)
        this.agentStore.save(folders).then(() => {
          this.notifyRenderer(folders)
        }).catch((err) => {
          console.warn('[PipeServer] Failed to save agents:', err)
        })
        return { result: 'ok' }
      }

      case 'agents.edit': {
        const agentName = request.params?.name as string | undefined
        const updates = request.params?.updates as Partial<AgentProfile> | undefined
        if (!agentName) return { error: 'Missing "name" param' }
        if (!updates || Object.keys(updates).length === 0) {
          return { error: 'Missing "updates" param' }
        }
        const allFolders = this.agentStore.getGroups()
        let found = false
        for (const f of allFolders) {
          const agent = f.agents.find((a) => a.name === agentName)
          if (agent) {
            if (updates.name) agent.name = updates.name
            if (updates.command) agent.command = updates.command
            if (updates.args) agent.args = updates.args
            found = true
            break
          }
        }
        if (!found) return { error: `Agent "${agentName}" not found` }
        this.agentStore.save(allFolders).then(() => {
          this.notifyRenderer(allFolders)
        }).catch((err) => {
          console.warn('[PipeServer] Failed to save agents:', err)
        })
        return { result: 'ok' }
      }

      case 'agents.remove': {
        const removeName = request.params?.name as string | undefined
        if (!removeName) return { error: 'Missing "name" param' }
        const groups = this.agentStore.getGroups()
        let removed = false
        for (const f of groups) {
          const idx = f.agents.findIndex((a) => a.name === removeName)
          if (idx !== -1) {
            f.agents.splice(idx, 1)
            removed = true
            break
          }
        }
        if (!removed) return { error: `Agent "${removeName}" not found` }
        this.agentStore.save(groups).then(() => {
          this.notifyRenderer(groups)
        }).catch((err) => {
          console.warn('[PipeServer] Failed to save agents:', err)
        })
        return { result: 'ok' }
      }

      case 'projects.list':
        return {
          result: this.agentStore.getGroups().map((f) => ({
            id: f.id,
            name: f.name,
            agentCount: f.agents.length
          }))
        }

      case 'projects.add': {
        const projName = request.params?.name as string | undefined
        if (!projName) return { error: 'Missing "name" param' }
        const projFolders = this.agentStore.getGroups()
        if (projFolders.find((f) => f.name === projName)) {
          return { error: `Project "${projName}" already exists` }
        }
        projFolders.push({ id: uuid(), name: projName, agents: [] })
        this.agentStore.save(projFolders).then(() => {
          this.notifyRenderer(projFolders)
        }).catch((err) => {
          console.warn('[PipeServer] Failed to save agents:', err)
        })
        return { result: 'ok' }
      }

      case 'projects.remove': {
        const projRemoveName = request.params?.name as string | undefined
        if (!projRemoveName) return { error: 'Missing "name" param' }
        const projRemFolders = this.agentStore.getGroups()
        const projToRemove = findFolder(projRemFolders, projRemoveName)
        if (!projToRemove) return { error: `Project "${projRemoveName}" not found` }
        const projIdx = projRemFolders.indexOf(projToRemove)
        projRemFolders.splice(projIdx, 1)
        this.agentStore.save(projRemFolders).then(() => {
          this.notifyRenderer(projRemFolders)
        }).catch((err) => {
          console.warn('[PipeServer] Failed to save agents:', err)
        })
        return { result: 'ok' }
      }

      case 'projects.rename': {
        const oldName = request.params?.oldName as string | undefined
        const newName = request.params?.newName as string | undefined
        if (!oldName || !newName) return { error: 'Missing "oldName" or "newName" param' }
        const renameFolders = this.agentStore.getGroups()
        const target = findFolder(renameFolders, oldName)
        if (!target) return { error: `Project "${oldName}" not found` }
        if (renameFolders.find((f) => f.name === newName)) {
          return { error: `Project "${newName}" already exists` }
        }
        target.name = newName
        this.agentStore.save(renameFolders).then(() => {
          this.notifyRenderer(renameFolders)
        }).catch((err) => {
          console.warn('[PipeServer] Failed to save agents:', err)
        })
        return { result: 'ok' }
      }

      case 'config.export': {
        const config = this.configStore.getAll()
        const agents = this.agentStore.getGroups()
        return { result: { version: 1, config, agents } }
      }

      case 'config.import': {
        const bundle = request.params as { config?: any; agents?: any } | undefined
        if (!bundle) return { error: 'Missing params' }
        if (bundle.config && typeof bundle.config === 'object') {
          this.configStore.save(bundle.config)
        }
        if (bundle.agents && Array.isArray(bundle.agents)) {
          this.agentStore.save(bundle.agents).then(() => {
            this.notifyRenderer(bundle.agents)
          }).catch((err) => {
            console.warn('[PipeServer] Failed to save agents:', err)
          })
        }
        return { result: 'ok' }
      }

      default:
        return { error: `Unknown method: ${request.method}` }
    }
  }

  private send(socket: Socket, response: RpcResponse): void {
    try {
      socket.write(JSON.stringify(response) + '\n')
    } catch {
      // socket may be closed
    }
  }

  private notifyRenderer(groups: unknown): void {
    this.getWindow()?.webContents.send('agents:updated', groups)
  }
}
