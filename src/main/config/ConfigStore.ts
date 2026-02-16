import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface TangentConfig {
  startFolder?: string
}

const CONFIG_DIR = join(homedir(), '.tangent')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

const DEFAULTS: TangentConfig = {
  startFolder: undefined
}

export class ConfigStore {
  private config: TangentConfig = { ...DEFAULTS }

  load(): TangentConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, 'utf-8')
        const parsed = JSON.parse(raw)
        this.config = { ...DEFAULTS, ...parsed }
      }
    } catch (err) {
      console.warn('[ConfigStore] Failed to load config:', err)
      this.config = { ...DEFAULTS }
    }
    return this.config
  }

  get(): TangentConfig {
    return this.config
  }

  getStartFolder(): string {
    return this.config.startFolder || homedir()
  }

  save(updates: Partial<TangentConfig>): void {
    this.config = { ...this.config, ...updates }
    try {
      mkdirSync(CONFIG_DIR, { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[ConfigStore] Failed to save config:', err)
    }
  }
}
