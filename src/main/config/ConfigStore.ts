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

/** Known config keys and their expected types for runtime validation */
const KNOWN_KEYS: Record<keyof TangentConfig, string> = {
  startFolder: 'string',
  editor: 'string',
  fontSize: 'number',
  defaultAgentCommand: 'string',
  defaultAgentArgs: 'string'
}

/**
 * Extract only recognized TangentConfig fields with correct types from raw JSON.
 * Returns { known, extra } so callers can preserve unrecognized fields on disk.
 */
export function parseConfig(raw: Record<string, unknown>): { known: TangentConfig; extra: Record<string, unknown> } {
  const known: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(raw)) {
    if (key in KNOWN_KEYS) {
      const expected = KNOWN_KEYS[key as keyof TangentConfig]
      // Accept the value only if it matches the expected type (or is null/undefined)
      if (value == null || typeof value === expected) {
        known[key] = value
      } else {
        console.warn(`[ConfigStore] Ignoring "${key}": expected ${expected}, got ${typeof value}`)
      }
    } else {
      extra[key] = value
    }
  }

  return { known: known as TangentConfig, extra }
}

export class ConfigStore extends EventEmitter {
  private config: TangentConfig = { ...DEFAULTS }
  /** Fields from the config file that this version doesn't recognize — preserved on save */
  private extraFields: Record<string, unknown> = {}
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  load(): TangentConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const { known, extra } = parseConfig(parsed)
          this.config = { ...DEFAULTS, ...known }
          this.extraFields = extra
        } else {
          console.warn('[ConfigStore] Config file is not a JSON object, using defaults')
          this.config = { ...DEFAULTS }
          this.extraFields = {}
        }
      }
    } catch (err) {
      console.warn('[ConfigStore] Failed to load config:', err)
      this.config = { ...DEFAULTS }
      this.extraFields = {}
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
      // Merge extra fields from other Tangent versions so they aren't lost
      const merged = { ...this.extraFields, ...this.config }
      writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
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
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const { known, extra } = parseConfig(parsed)
              this.config = { ...DEFAULTS, ...known }
              this.extraFields = extra
            }
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
