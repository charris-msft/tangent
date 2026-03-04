import { existsSync, readFileSync, writeFileSync, mkdirSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { EventEmitter } from 'events'

export interface TangentConfig {
  startFolder?: string
  editor?: string
  fontSize?: number
  defaultAgentCommand?: string
  defaultAgentArgs?: string
}

const CONFIG_DIR = join(homedir(), '.tangent')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

const DEFAULTS: TangentConfig = {
  startFolder: undefined
}

export class ConfigStore extends EventEmitter {
  private config: TangentConfig = { ...DEFAULTS }
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

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
    this.startWatching()
    return this.config
  }

  get(): TangentConfig {
    return this.config
  }

  getStartFolder(): string {
    return this.config.startFolder || homedir()
  }

  getAll(): TangentConfig {
    return { ...this.config }
  }

  set(key: string, value: unknown): void {
    this.save({ [key]: value })
  }

  getEditor(): string {
    return this.config.editor || 'code'
  }

  setEditor(editor: string): void {
    this.save({ editor })
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

  getConfigPath(): string {
    return CONFIG_PATH
  }

  private startWatching(): void {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true })
      // Ensure config file exists so watcher has something to watch
      if (!existsSync(CONFIG_PATH)) {
        writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
      }
      this.watcher = watch(CONFIG_PATH, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => {
          try {
            const raw = readFileSync(CONFIG_PATH, 'utf-8')
            const parsed = JSON.parse(raw)
            this.config = { ...DEFAULTS, ...parsed }
            this.emit('changed', this.config)
          } catch (err) {
            console.warn('[ConfigStore] Failed to reload config on change:', err)
          }
        }, 500)
      })
    } catch (err) {
      console.warn('[ConfigStore] Failed to start file watcher:', err)
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}
