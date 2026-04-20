import { useState, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSessions } from '@/hooks/useSession'
import { useAgents } from '@/hooks/useAgents'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { SessionsPanel } from '@/components/SessionsPanel/SessionsPanel'
import { TerminalViewport } from '@/components/Terminal/TerminalViewport'
import { AgentsSidebar } from '@/components/AgentsSidebar/AgentsSidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { SettingsPanel } from '@/components/SettingsPanel/SettingsPanel'
import { PermissionDialog } from '@/components/PermissionDialog'
import { UserInputDialog } from '@/components/UserInputDialog'
import { HumanContextPanel } from '@/components/HumanContextPanel/HumanContextPanel'
import { DisplayPicker } from '@/components/DisplayPicker'
import { useExplode } from '@/hooks/useExplode'
import { ZOOM } from '@shared/constants'
import type { AgentProfile, Session } from '@shared/types'

export function App(): JSX.Element {
  const { sessions, activeId, activeSession, poppedOutSessionIds, createSession, selectSession, closeSession, renameSession, popOutSession, pullBackSession } =
    useSessions()
  const { groups, launchAgent } = useAgents()
  const [fontSize, setFontSize] = useState(ZOOM.DEFAULT)
  // Hydrate fontSize from persisted config, and react to external changes
  // (e.g. edits via Settings in popout windows).
  useEffect(() => {
    let cancelled = false
    window.tangentAPI.config.get().then((config: any) => {
      if (!cancelled && typeof config?.fontSize === 'number') {
        setFontSize(config.fontSize)
      }
    })
    const unsub = window.tangentAPI.config.onChanged((config: any) => {
      if (typeof config?.fontSize === 'number') setFontSize(config.fontSize)
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])
  const [sessionsPanelVisible, setSessionsPanelVisible] = useState(true)
  const [sessionsPanelWidth, setSessionsPanelWidth] = useState(240)
  const [prefillAgent, setPrefillAgent] = useState<AgentProfile | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contextPanelVisible, setContextPanelVisible] = useState(true)
  const [explodeOpen, setExplodeOpen] = useState(false)
  const explodeAll = useExplode(sessions)

  const eligibleExplodeCount = sessions.filter(
    s => s.status !== 'exited'
  ).length

  const handleCreateAgentFromSession = useCallback((session: Session) => {
    const command = session.agentCommand || ''
    const args = session.agentArgs || []
    const agent: AgentProfile = {
      id: uuidv4(),
      name: session.name || 'New Agent',
      command,
      args,
      env: session.agentEnv,
      cwdMode: 'activeSession',
      launchTarget: 'path',
      cwdPath: session.folderPath || '',
    }
    setPrefillAgent(agent)
  }, [])

  const toggleSettings = useCallback(() => {
    setSettingsOpen(prev => !prev)
  }, [])

  const toggleSessionsPanel = useCallback(() => {
    setSessionsPanelVisible(prev => !prev)
  }, [])

  const toggleContextPanel = useCallback(() => {
    setContextPanelVisible(prev => !prev)
  }, [])

  const toggleSidebar = useCallback(() => {
    // No-op — sidebar is now always-visible tabs
  }, [])

  const launchAgentByIndex = useCallback(
    (index: number) => {
      if (!activeId || groups.length === 0) return
      const activeGroup = groups[0]
      if (!activeGroup || index < 0 || index >= activeGroup.agents.length) return
      launchAgent(activeGroup.agents[index].id, activeId)
    },
    [activeId, groups, launchAgent]
  )

  useGlobalShortcuts({
    onPopOutActive: useCallback(() => {
      if (!activeId) return
      if (poppedOutSessionIds.has(activeId)) return
      void popOutSession(activeId)
    }, [activeId, poppedOutSessionIds, popOutSession]),
    onExplode: useCallback(() => {
      if (eligibleExplodeCount === 0) return
      setExplodeOpen(true)
    }, [eligibleExplodeCount]),
    onCollapseAll: useCallback(() => {
      const winApi = (window.tangentAPI as any)?.window
      winApi?.collapseAll?.()
    }, [])
  })

  useKeyboard({
    createSession,
    closeSession,
    selectSession,
    sessions,
    activeId,
    fontSize,
    setFontSize,
    toggleSessionsPanel,
    toggleSidebar,
    toggleContextPanel,
    launchAgentByIndex
  })

  return (
    <div className="flex flex-col h-screen w-screen relative">
      <div className="flex flex-1 min-h-0">
        {sessionsPanelVisible && (
          <SessionsPanel
            sessions={sessions}
            activeId={activeId}
            onSelect={selectSession}
            onClose={closeSession}
            onCreate={createSession}
            onRename={renameSession}
            onCreateAgent={handleCreateAgentFromSession}
            width={sessionsPanelWidth}
            onWidthChange={setSessionsPanelWidth}
            onCollapse={() => setSessionsPanelVisible(false)}
            onPopOut={popOutSession}
            onPullBack={pullBackSession}
            poppedOutSessionIds={poppedOutSessionIds}
          />
        )}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {contextPanelVisible && (
            <HumanContextPanel sessionId={activeId} />
          )}
          <TerminalViewport
            sessions={sessions}
            activeId={activeId}
            fontSize={fontSize}
            poppedOutSessionIds={poppedOutSessionIds}
            onPullBack={pullBackSession}
          />
        </div>
        <AgentsSidebar activeSessionId={activeId} prefillAgent={prefillAgent} onPrefillConsumed={() => setPrefillAgent(null)} />
      </div>
      <StatusBar
        sessions={sessions}
        activeSession={activeSession}
        onToggleSettings={toggleSettings}
        onExplode={() => setExplodeOpen(true)}
        explodeDisabled={eligibleExplodeCount === 0}
      />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} fontSize={fontSize} setFontSize={setFontSize} />}
      <DisplayPicker
        isOpen={explodeOpen}
        onClose={() => setExplodeOpen(false)}
        onConfirm={(ids) => { void explodeAll(ids) }}
        confirmLabel="Explode"
      />
      {activeSession?.kind === 'copilot-sdk' && (
        <>
          <PermissionDialog sessionId={activeId} />
          <UserInputDialog sessionId={activeId} />
        </>
      )}
    </div>
  )
}
