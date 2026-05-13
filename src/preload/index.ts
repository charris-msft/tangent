import { contextBridge, ipcRenderer } from 'electron'

const tangentAPI = {
  session: {
    getAll: () => ipcRenderer.invoke('session:getAll'),
    create: () => ipcRenderer.invoke('session:create'),
    close: (id: string) => ipcRenderer.invoke('session:close', id),
    select: (id: string) => ipcRenderer.invoke('session:select', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('session:rename', id, name),
    scanExternal: () => ipcRenderer.invoke('session:scanExternal'),
    reconnect: (id: string) => ipcRenderer.invoke('session:reconnect', id),

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
    launchByName: (agentName: string, sessionId?: string) =>
      ipcRenderer.invoke('agents:launchByName', agentName, sessionId),

    onUpdated: (cb: (groups: any) => void) => {
      const handler = (_: any, groups: any) => cb(groups)
      ipcRenderer.on('agents:updated', handler)
      return () => { ipcRenderer.removeListener('agents:updated', handler) }
    },

    onLaunchFailed: (cb: (data: { agentId: string; agentName: string; error: string }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('agents:launchFailed', handler)
      return () => { ipcRenderer.removeListener('agents:launchFailed', handler) }
    }
  },

  test: {
    getSessionStates: () => ipcRenderer.invoke('test:getSessionStates'),
    setSessionState: (sessionId: string, patch: any) =>
      ipcRenderer.invoke('test:setSessionState', sessionId, patch),
    recordTimelineItem: (sessionId: string, promptText: string, responseText?: string) =>
      ipcRenderer.invoke('test:recordTimelineItem', sessionId, promptText, responseText)
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

  timeline: {
    get: (sessionId: string, opts?: { limit?: number; offset?: number }) =>
      ipcRenderer.invoke('timeline:get', sessionId, opts),

    onItemAdded: (cb: (item: any) => void) => {
      const handler = (_: any, item: any) => cb(item)
      ipcRenderer.on('timeline:item-added', handler)
      return () => { ipcRenderer.removeListener('timeline:item-added', handler) }
    },
    onItemUpdated: (cb: (item: any) => void) => {
      const handler = (_: any, item: any) => cb(item)
      ipcRenderer.on('timeline:item-updated', handler)
      return () => { ipcRenderer.removeListener('timeline:item-updated', handler) }
    }
  },

  shell: {
    openInVSCode: (folderPath: string) => ipcRenderer.invoke('shell:openInVSCode', folderPath),
    openInExplorer: (folderPath: string) => ipcRenderer.invoke('shell:openInExplorer', folderPath),
    openEditor: (folderPath: string) => ipcRenderer.invoke('shell:openEditor', { folderPath }),
    getEditor: () => ipcRenderer.invoke('shell:getEditor'),
    setEditor: (editor: string) => ipcRenderer.invoke('shell:setEditor', { editor }),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
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

  context: {
    get: (sessionId: string) => ipcRenderer.invoke('context:get', sessionId),
    getPrompts: (sessionId: string) => ipcRenderer.invoke('context:getPrompts', sessionId),
    recordPrompt: (sessionId: string, text: string, source: 'terminal' | 'sdk') => {
      ipcRenderer.send('context:recordPrompt', sessionId, text, source)
    },
    onUpdated: (cb: (ctx: any) => void) => {
      const handler = (_: any, ctx: any) => cb(ctx)
      ipcRenderer.on('context:updated', handler)
      return () => { ipcRenderer.removeListener('context:updated', handler) }
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
  },

  devbox: {
    list: () => ipcRenderer.invoke('devbox:list'),
    hasSshConfig: (devBoxName: string) =>
      ipcRenderer.invoke('devbox:hasSshConfig', devBoxName),
    start: (projectName: string, devBoxName: string) =>
      ipcRenderer.invoke('devbox:start', projectName, devBoxName),
    stop: (projectName: string, devBoxName: string) =>
      ipcRenderer.invoke('devbox:stop', projectName, devBoxName),
    getConnectionInfo: (projectName: string, devBoxName: string) =>
      ipcRenderer.invoke('devbox:getConnectionInfo', projectName, devBoxName),
    checkHealth: (projectName: string, devBoxName: string) =>
      ipcRenderer.invoke('devbox:checkHealth', projectName, devBoxName),
    autoStart: (projectName: string, devBoxName: string, reportProgress = false) =>
      ipcRenderer.invoke('devbox:autoStart', projectName, devBoxName, reportProgress),
    preflight: (projectName: string, devBoxName: string) =>
      ipcRenderer.invoke('devbox:preflight', projectName, devBoxName),

    onStateChanged: (cb: (data: { devBoxName: string; state: string }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:stateChanged', handler)
      return () => { ipcRenderer.removeListener('devbox:stateChanged', handler) }
    },
    onHealthUpdated: (cb: (data: { devBoxName: string; health: any }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:healthUpdated', handler)
      return () => { ipcRenderer.removeListener('devbox:healthUpdated', handler) }
    },
    onError: (cb: (data: { devBoxName: string; error: string }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:error', handler)
      return () => { ipcRenderer.removeListener('devbox:error', handler) }
    },
    onAutoStartProgress: (cb: (data: {
      projectName: string
      devBoxName: string
      state: string
      elapsed: number
    }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:autoStartProgress', handler)
      return () => { ipcRenderer.removeListener('devbox:autoStartProgress', handler) }
    },

    // Interactive dev tunnel sign-in. Opens a browser via `devtunnel user login -g`.
    signIn: (): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('devbox:signIn'),
    onAuthRequired: (cb: (data: { tunnelId?: string; reason?: string; message: string }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:authRequired', handler)
      return () => { ipcRenderer.removeListener('devbox:authRequired', handler) }
    },
    onSignInStarted: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('devbox:signInStarted', handler)
      return () => { ipcRenderer.removeListener('devbox:signInStarted', handler) }
    },
    onSignInComplete: (cb: (data: { message: string }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:signInComplete', handler)
      return () => { ipcRenderer.removeListener('devbox:signInComplete', handler) }
    },
    onSignInFailed: (cb: (data: { message: string }) => void) => {
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on('devbox:signInFailed', handler)
      return () => { ipcRenderer.removeListener('devbox:signInFailed', handler) }
    }
  },

  window: {
    popOut: (sessionId: string, bounds?: { x?: number; y?: number; width: number; height: number }): Promise<boolean> =>
      ipcRenderer.invoke('window:popOut', sessionId, bounds),
    setMainBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<boolean> =>
      ipcRenderer.invoke('window:setMainBounds', bounds),
    getMainBounds: (): Promise<{ x: number; y: number; width: number; height: number } | null> =>
      ipcRenderer.invoke('window:getMainBounds'),
    pullBack: (sessionId: string): Promise<void> => ipcRenderer.invoke('window:pullBack', sessionId),
    collapseAll: (): Promise<void> => ipcRenderer.invoke('window:collapseAll'),
    isPoppedOut: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('window:isPoppedOut', sessionId),
    getPoppedSessionIds: (): Promise<string[]> => ipcRenderer.invoke('window:getPoppedSessionIds'),
    getDisplays: () => ipcRenderer.invoke('window:getDisplays'),
    setCompactMode: (compactWidth: number): Promise<boolean> =>
      ipcRenderer.invoke('window:setCompactMode', compactWidth),
    restoreFromCompact: (): Promise<boolean> =>
      ipcRenderer.invoke('window:restoreFromCompact'),
    isInCompactMode: (): Promise<boolean> =>
      ipcRenderer.invoke('window:isInCompactMode'),

    onPoppedOut: (cb: (sessionId: string) => void) => {
      const handler = (_: any, sessionId: string) => cb(sessionId)
      ipcRenderer.on('window:popped-out', handler)
      return () => { ipcRenderer.removeListener('window:popped-out', handler) }
    },
    onPulledBack: (cb: (sessionId: string) => void) => {
      const handler = (_: any, sessionId: string) => cb(sessionId)
      ipcRenderer.on('window:pulled-back', handler)
      return () => { ipcRenderer.removeListener('window:pulled-back', handler) }
    },
    onCollapsedAll: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('window:collapsed-all', handler)
      return () => { ipcRenderer.removeListener('window:collapsed-all', handler) }
    }
  },

  acp: {
    respondPermission: (requestId: string, approved: boolean, rememberChoice = false) => {
      ipcRenderer.send('acp:permission-response', {
        requestId,
        approved,
        rememberChoice
      })
    },

    onOutput: (cb: (output: { sessionId: string; text: string }) => void) => {
      const handler = (_: any, output: any) => cb(output)
      ipcRenderer.on('acp:output', handler)
      return () => { ipcRenderer.removeListener('acp:output', handler) }
    },
    onPermissionRequest: (cb: (request: any) => void) => {
      const handler = (_: any, request: any) => cb(request)
      ipcRenderer.on('acp:permission-request', handler)
      return () => { ipcRenderer.removeListener('acp:permission-request', handler) }
    },
    onConnected: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('acp:connected', handler)
      return () => { ipcRenderer.removeListener('acp:connected', handler) }
    },
    onDisconnected: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('acp:disconnected', handler)
      return () => { ipcRenderer.removeListener('acp:disconnected', handler) }
    },
    onSessionCreated: (cb: (session: any) => void) => {
      const handler = (_: any, session: any) => cb(session)
      ipcRenderer.on('acp:session-created', handler)
      return () => { ipcRenderer.removeListener('acp:session-created', handler) }
    },
    onMessage: (cb: (response: any) => void) => {
      const handler = (_: any, response: any) => cb(response)
      ipcRenderer.on('acp:message', handler)
      return () => { ipcRenderer.removeListener('acp:message', handler) }
    },
    onError: (cb: (error: { message: string; stack?: string }) => void) => {
      const handler = (_: any, error: any) => cb(error)
      ipcRenderer.on('acp:error', handler)
      return () => { ipcRenderer.removeListener('acp:error', handler) }
    }
  }
}

contextBridge.exposeInMainWorld('tangentAPI', tangentAPI)
