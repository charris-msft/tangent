import { contextBridge, ipcRenderer } from 'electron'

const tangentAPI = {
  session: {
    getAll: () => ipcRenderer.invoke('session:getAll'),
    create: () => ipcRenderer.invoke('session:create'),
    close: (id: string) => ipcRenderer.invoke('session:close', id),
    select: (id: string) => ipcRenderer.invoke('session:select', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('session:rename', id, name),
    scanExternal: () => ipcRenderer.invoke('session:scanExternal'),

    onCreated: (cb: (session: any) => void) => {
      const handler = (_: any, session: any) => cb(session)
      ipcRenderer.on('session:created', handler)
      return () => { ipcRenderer.removeListener('session:created', handler) }
    },
    onUpdated: (cb: (session: any) => void) => {
      const handler = (_: any, session: any) => cb(session)
      ipcRenderer.on('session:updated', handler)
      return () => { ipcRenderer.removeListener('session:updated', handler) }
    },
    onClosed: (cb: (sessionId: string) => void) => {
      const handler = (_: any, sessionId: string) => cb(sessionId)
      ipcRenderer.on('session:closed', handler)
      return () => { ipcRenderer.removeListener('session:closed', handler) }
    }
  },

  terminal: {
    write: (sessionId: string, data: string) => {
      ipcRenderer.send('terminal:write', sessionId, data)
    },
    attach: (sessionId: string) => ipcRenderer.invoke('terminal:attach', sessionId),
    onData: (sessionId: string, cb: (data: string) => void) => {
      const channel = `terminal:data:${sessionId}`
      const handler = (_: any, data: string) => cb(data)
      ipcRenderer.on(channel, handler)
      return () => { ipcRenderer.removeListener(channel, handler) }
    },
    resize: (sessionId: string, cols: number, rows: number) => {
      ipcRenderer.send('terminal:resize', sessionId, cols, rows)
    }
  },

  agents: {
    getGroups: () => ipcRenderer.invoke('agents:getGroups'),
    saveGroups: (groups: any) => ipcRenderer.invoke('agents:saveGroups', groups),
    launch: (agentId: string, sessionId: string) =>
      ipcRenderer.invoke('agents:launch', agentId, sessionId),

    onUpdated: (cb: (groups: any) => void) => {
      const handler = (_: any, groups: any) => cb(groups)
      ipcRenderer.on('agents:updated', handler)
      return () => { ipcRenderer.removeListener('agents:updated', handler) }
    }
  },

  sdk: {
    sendMessage: (sessionId: string, prompt: string) =>
      ipcRenderer.invoke('sdk:sendMessage', sessionId, prompt),
    approvePermission: (sessionId: string, approved: boolean) =>
      ipcRenderer.invoke('sdk:approvePermission', sessionId, approved),
    answerInput: (sessionId: string, answer: string, wasFreeform: boolean) =>
      ipcRenderer.invoke('sdk:answerInput', sessionId, answer, wasFreeform),

    onOutput: (sessionId: string, cb: (data: string) => void) => {
      const channel = `sdk:output:${sessionId}`
      const handler = (_: any, data: string) => cb(data)
      ipcRenderer.on(channel, handler)
      return () => { ipcRenderer.removeListener(channel, handler) }
    },
    onPermissionRequest: (sessionId: string, cb: (request: any) => void) => {
      const channel = `sdk:permission:${sessionId}`
      const handler = (_: any, request: any) => cb(request)
      ipcRenderer.on(channel, handler)
      return () => { ipcRenderer.removeListener(channel, handler) }
    },
    onUserInput: (sessionId: string, cb: (request: any) => void) => {
      const channel = `sdk:userInput:${sessionId}`
      const handler = (_: any, request: any) => cb(request)
      ipcRenderer.on(channel, handler)
      return () => { ipcRenderer.removeListener(channel, handler) }
    }
  },

  shell: {
    openInVSCode: (folderPath: string) => ipcRenderer.invoke('shell:openInVSCode', folderPath),
    openInExplorer: (folderPath: string) => ipcRenderer.invoke('shell:openInExplorer', folderPath),
    openEditor: (folderPath: string) => ipcRenderer.invoke('shell:openEditor', { folderPath }),
    getEditor: () => ipcRenderer.invoke('shell:getEditor'),
    setEditor: (editor: string) => ipcRenderer.invoke('shell:setEditor', { editor })
  },

  fs: {
    suggestDirs: (partial: string): Promise<string[]> => ipcRenderer.invoke('fs:suggestDirs', partial)
  },

  dialog: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
    openFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openFile', filters),
    saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', options)
  },

  tooluse: {
    getAll: (sessionId: string) => ipcRenderer.invoke('tooluse:getAll', sessionId),
    onEntry: (cb: (entry: any) => void) => {
      const handler = (_: any, entry: any) => cb(entry)
      ipcRenderer.on('tooluse:entry', handler)
      return () => { ipcRenderer.removeListener('tooluse:entry', handler) }
    }
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (key: string, value: unknown) => ipcRenderer.invoke('config:update', { key, value }),
    openFile: () => ipcRenderer.invoke('config:openFile'),
    exportConfig: () => ipcRenderer.invoke('config:export'),
    importConfig: (bundle: any) => ipcRenderer.invoke('config:import', bundle),
    writeExport: (filePath: string, bundle: any) => ipcRenderer.invoke('config:writeExport', filePath, bundle),
    readImport: (filePath: string) => ipcRenderer.invoke('config:readImport', filePath),
    onChanged: (cb: (config: any) => void) => {
      const handler = (_: any, config: any) => cb(config)
      ipcRenderer.on('config:changed', handler)
      return () => { ipcRenderer.removeListener('config:changed', handler) }
    }
  },

  app: {
    getZoom: () => ipcRenderer.invoke('app:getZoom'),
    setZoom: (level: number) => ipcRenderer.invoke('app:setZoom', level),
    onZoomChanged: (cb: (level: number) => void) => {
      const handler = (_: any, level: number) => cb(level)
      ipcRenderer.on('app:zoomChanged', handler)
      return () => { ipcRenderer.removeListener('app:zoomChanged', handler) }
    }
  }
}

contextBridge.exposeInMainWorld('tangentAPI', tangentAPI)
