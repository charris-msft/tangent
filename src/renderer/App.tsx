import { useState, useCallback } from 'react'
import { useSessions } from '@/hooks/useSession'
import { useAgents } from '@/hooks/useAgents'
import { useKeyboard } from '@/hooks/useKeyboard'
import { SessionsPanel } from '@/components/SessionsPanel/SessionsPanel'
import { TerminalViewport } from '@/components/Terminal/TerminalViewport'
import { AgentsSidebar } from '@/components/AgentsSidebar/AgentsSidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { PermissionDialog } from '@/components/PermissionDialog'
import { UserInputDialog } from '@/components/UserInputDialog'
import { ZOOM } from '@shared/constants'

export function App(): JSX.Element {
  const { sessions, activeId, activeSession, createSession, selectSession, closeSession, renameSession } =
    useSessions()
  const { groups, launchAgent } = useAgents()
  const [fontSize, setFontSize] = useState(ZOOM.DEFAULT)
  const [sessionsPanelVisible, setSessionsPanelVisible] = useState(true)
  const [sessionsPanelWidth, setSessionsPanelWidth] = useState(240)

  const toggleSessionsPanel = useCallback(() => {
    setSessionsPanelVisible(prev => !prev)
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
    launchAgentByIndex
  })

  return (
    <div className="flex flex-col h-screen w-screen">
      <div className="flex flex-1 min-h-0">
        {sessionsPanelVisible && (
          <SessionsPanel
            sessions={sessions}
            activeId={activeId}
            onSelect={selectSession}
            onClose={closeSession}
            onCreate={createSession}
            onRename={renameSession}
            width={sessionsPanelWidth}
            onWidthChange={setSessionsPanelWidth}
            onCollapse={() => setSessionsPanelVisible(false)}
          />
        )}
        <TerminalViewport sessions={sessions} activeId={activeId} fontSize={fontSize} />
        <AgentsSidebar activeSessionId={activeId} />
      </div>
      <StatusBar sessions={sessions} activeSession={activeSession} />
      {activeSession?.kind === 'copilot-sdk' && (
        <>
          <PermissionDialog sessionId={activeId} />
          <UserInputDialog sessionId={activeId} />
        </>
      )}
    </div>
  )
}
