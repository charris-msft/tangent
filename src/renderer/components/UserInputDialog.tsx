import { useEffect, useState, useCallback, useRef } from 'react'

interface UserInputRequest {
  question: string
  choices?: string[]
  allowFreeform: boolean
}

interface UserInputDialogProps {
  sessionId: string | null
}

export function UserInputDialog({ sessionId }: UserInputDialogProps) {
  const [request, setRequest] = useState<UserInputRequest | null>(null)
  const [freeformText, setFreeformText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!sessionId) return
    const unsub = window.tangentAPI.sdk.onUserInput(sessionId, (req: UserInputRequest) => {
      setRequest(req)
      setFreeformText('')
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => {
    if (request && request.allowFreeform && inputRef.current) {
      inputRef.current.focus()
    }
  }, [request])

  const handleSubmit = useCallback((answer: string, wasFreeform: boolean) => {
    if (sessionId) {
      window.tangentAPI.sdk.answerInput(sessionId, answer, wasFreeform)
    }
    setRequest(null)
  }, [sessionId])

  const handleFreeformSubmit = useCallback(() => {
    if (freeformText.trim()) {
      handleSubmit(freeformText.trim(), true)
    }
  }, [freeformText, handleSubmit])

  if (!request) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="rounded-lg p-5 shadow-xl max-w-md w-full mx-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-hover)' }}
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Agent Question
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
          {request.question}
        </p>

        {/* Choice buttons */}
        {request.choices && request.choices.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3">
            {request.choices.map((choice, i) => (
              <button
                key={i}
                onClick={() => handleSubmit(choice, false)}
                className="px-3 py-1.5 text-xs rounded text-left"
                style={{
                  background: 'var(--bg-hover)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--bg-hover)'
                }}
              >
                {choice}
              </button>
            ))}
          </div>
        )}

        {/* Freeform input */}
        {request.allowFreeform && (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={freeformText}
              onChange={e => setFreeformText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleFreeformSubmit() }}
              placeholder="Type your answer..."
              className="flex-1 px-2 py-1.5 text-xs rounded"
              style={{
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--bg-hover)',
                outline: 'none'
              }}
            />
            <button
              onClick={handleFreeformSubmit}
              className="px-3 py-1.5 text-xs rounded font-medium"
              style={{
                background: 'var(--running)',
                color: '#fff',
                border: 'none'
              }}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
