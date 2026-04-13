import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { v4 as uuid } from 'uuid'
import type { ProjectFolder, AgentStoreData } from '@shared/types'

const STORE_DIR = join(homedir(), '.tangent')
const STORE_PATH = join(STORE_DIR, 'agents.json')

function defaultGroups(): ProjectFolder[] {
  return [
    {
      id: uuid(),
      name: 'Agents',
      agents: [
        {
          id: uuid(),
          name: 'Copilot CLI',
          command: 'copilot',
          args: [],
          cwdMode: 'activeSession',
          launchTarget: 'currentTab'
        },
        {
          id: uuid(),
          name: 'Claude Code',
          command: 'claude',
          args: [],
          cwdMode: 'activeSession',
          launchTarget: 'currentTab'
        }
      ]
    }
  ]
}

export class AgentStore {
  private folders: ProjectFolder[] = []

  async load(): Promise<ProjectFolder[]> {
    try {
      const data = await readFile(STORE_PATH, 'utf-8')
      const parsed = JSON.parse(data)
      
      // Migration logic
      if (parsed.version === 3) {
        // Already v3 — use as-is
        this.folders = parsed.groups
      } else if (parsed.version === 2) {
        // Migrate v2 → v3: add remote field with default { enabled: false }
        this.folders = parsed.groups.map((folder: ProjectFolder) => ({
          ...folder,
          agents: folder.agents.map(agent => ({
            ...agent,
            remote: agent.remote || { enabled: false }
          }))
        }))
        // Save migrated data as v3
        await this.save(this.folders)
      } else {
        // Unknown version — reset to defaults
        this.folders = defaultGroups()
      }
    } catch {
      this.folders = defaultGroups()
    }
    return this.folders
  }

  async save(folders: ProjectFolder[]): Promise<void> {
    this.folders = folders
    const data: AgentStoreData = { version: 3, groups: folders }
    await mkdir(STORE_DIR, { recursive: true })
    await writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8')
  }

  getGroups(): ProjectFolder[] {
    return this.folders
  }

  findAgent(agentId: string) {
    for (const folder of this.folders) {
      const agent = folder.agents.find(a => a.id === agentId)
      if (agent) return agent
    }
    return undefined
  }
}
