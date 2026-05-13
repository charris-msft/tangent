import { useState, useEffect, useCallback } from 'react'
import type { ProjectFolder, AgentLaunchResult } from '@shared/types'

export function useAgents() {
  const [groups, setGroups] = useState<ProjectFolder[]>([])

  useEffect(() => {
    window.tangentAPI.agents.getGroups().then((loaded: ProjectFolder[]) => {
      setGroups(loaded)
    })

    const unsubscribe = window.tangentAPI.agents.onUpdated((updated: ProjectFolder[]) => {
      setGroups(updated)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const saveGroups = useCallback(async (updatedGroups: ProjectFolder[]) => {
    await window.tangentAPI.agents.saveGroups(updatedGroups)
  }, [])

  const launchAgent = useCallback(async (agentId: string, sessionId: string) => {
    const result = await window.tangentAPI.agents.launch(agentId, sessionId)
    return result as AgentLaunchResult
  }, [])

  return { groups, saveGroups, launchAgent }
}
