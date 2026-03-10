# Feature Request: Client-level session event API for hybrid PTY+SDK consumers

## Summary

Terminal hosts that run Copilot CLI in a PTY with `--ui-server --port 0` and connect the SDK to the embedded server need three APIs the SDK doesn't currently provide:

1. **`client.onSessionEvent()`** — Client-level event handler that fires for ALL `session.event` notifications regardless of session ID matching
2. **`client.onUserInputRequested()` / `client.onUserInputCompleted()`** — Client-level notification callbacks for `ask_user` tool execution, independent of `session.resume`
3. **`client.onConnectionStateChange()`** — Observable connection lifecycle events

## Context: The hybrid PTY+SDK architecture

We're building [Tangent](https://github.com/charris-msft/tangent), an Electron terminal app that wraps Copilot CLI. The architecture:

```
PTY (node-pty)                           SDK (CopilotClient)
┌─────────────────────┐                  ┌──────────────────────┐
│ copilot --ui-server  │─── TCP ────────▶│ CopilotClient({      │
│   --port 0           │    port N       │   cliUrl: "localhost" │
│                      │                 │ })                    │
│ User sees full TUI   │                 │                       │
│ (Ink-based terminal) │                 │ Typed session events  │
└─────────────────────┘                  └──────────────────────┘
```

The PTY handles rendering — the user sees the full Copilot TUI. The SDK connects to the embedded JSON-RPC server for typed events (status, metrics, tool use tracking). This gives the best of both worlds: native TUI experience + deterministic machine-readable events.

## Problem 1: Session events are silently dropped (session ID mismatch)

`handleSessionEventNotification()` routes events via `this.sessions.get(sessionId)`. But in hybrid mode:

1. SDK connects to the running CLI's embedded server
2. `getForegroundSessionId()` returns session ID `A`
3. `resumeSession(A)` sends a `session.resume` RPC — the CLI may return a **different** session ID `B`
4. SDK stores the session as `this.sessions.set(B, session)`
5. CLI broadcasts events with session ID `A` (the original)
6. `this.sessions.get(A)` → `undefined` → **all events silently dropped**

In practice, `session.resume` frequently fails with "Session not found" because of a race between TUI session initialization and SDK connection. Even when it succeeds, the ID mismatch causes silent event loss.

**Impact:** Status detection, metrics, tool use tracking — everything that depends on session events — stops working. The consumer has no indication that events are being dropped.

### Proposed API: `client.onSessionEvent()`

```typescript
// Fires for every session.event notification, regardless of session ID matching
const unsubscribe = client.onSessionEvent((sessionId, event) => {
  switch (event.type) {
    case 'assistant.turn_start':
      updateStatus('processing')
      break
    case 'session.idle':
      updateStatus('idle')
      break
    case 'tool.execution_start':
      showToolInUI(event.data.toolName)
      break
    // ... etc
  }
})
```

Implementation — add at the end of `handleSessionEventNotification()`, after the existing session-level dispatch:

```typescript
// Existing code (keep as-is):
const session = this.sessions.get(sessionId);
if (session) {
    session._dispatchEvent(event);
}

// New: fire client-level handlers (no session ID filtering)
for (const handler of this.sessionEventHandlers) {
    try {
        handler(sessionId, event);
    } catch { /* */ }
}
```

## Problem 2: No client-level ask_user detection

The SDK's `onUserInputRequest` config option only works for SDK-managed sessions created via `createSession()`. In hybrid PTY+SDK mode, the TUI manages user input — the SDK just needs to **observe** that an `ask_user` happened (for status indicators like "needs input"), not handle it.

### Proposed API: `client.onUserInputRequested()` / `client.onUserInputCompleted()`

```typescript
// Notification-only: fires when CLI asks user a question (for status tracking)
client.onUserInputRequested((info) => {
  console.log(`Question: ${info.question}`)
  updateStatus('needs_input')
})

// Notification-only: fires when user answers (agent resumes)
client.onUserInputCompleted((info) => {
  console.log(`Answered: ${info.answer}`)
  updateStatus('processing')
})
```

These don't provide answers — the TUI handles the actual interaction. Detection works by watching `session.event` notifications for `tool.execution_start` / `tool.execution_complete` with `toolName === "ask_user"`, tracking `toolCallId` to pair start→complete:

```typescript
// In handleSessionEventNotification():
if (event.type === "tool.execution_start" && data?.toolName === "ask_user") {
    const toolCallId = data?.toolCallId as string;
    if (toolCallId) this.pendingAskUserCallIds.add(toolCallId);
    const question = (data?.arguments as any)?.question ?? "User input requested";
    for (const handler of this.userInputRequestHandlers) {
        handler({ sessionId, question });
    }
}

if (event.type === "tool.execution_complete") {
    const toolCallId = data?.toolCallId as string;
    if (toolCallId && this.pendingAskUserCallIds.delete(toolCallId)) {
        const answer = typeof data?.result === 'string'
            ? data.result : JSON.stringify(data?.result) ?? "";
        for (const handler of this.userInputCompletedHandlers) {
            handler({ sessionId, answer });
        }
    }
}
```

## Problem 3: Connection lifecycle not observable

When connecting to an external server via `cliUrl`, the SDK transitions through states (disconnected → connecting → connected → error → disconnected) but there's no way to observe these. Terminal hosts need this for connection health indicators and reconnection logic.

### Proposed API: `client.onConnectionStateChange()`

```typescript
type ConnectionState = "disconnected" | "connecting" | "connected" | "error"

interface ConnectionStateChange {
  previousState: ConnectionState
  currentState: ConnectionState
  reason?: string
  error?: Error
}

const unsubscribe = client.onConnectionStateChange((change) => {
  console.log(`${change.previousState} → ${change.currentState}`)
  if (change.error) console.error(change.error)
})
```

## What we use these for in production

With these three APIs, Tangent drives its entire UI from SDK events — no terminal output scraping needed:

| SDK Event / Callback | Tangent Feature |
|---|---|
| `assistant.turn_start` | Green "processing" status dot |
| `session.idle` | Yellow "idle" status dot |
| `tool.execution_start/complete` | Tool Use pane (live list of tools/skills/subagents with durations) |
| `assistant.usage` | Token count + cost in status bar (e.g., `184.9k/426 $9.00`) |
| `session.context_changed` | Working directory tracking |
| `session.title_changed` | Session activity label |
| `skill.invoked` | Skill entries with plugin name + version |
| `subagent.started/completed/failed` | Subagent lifecycle tracking |
| `onUserInputRequested` | Orange pulsing "needs input" status dot |
| `onUserInputCompleted` | Clears needs_input → processing |
| `onConnectionStateChange` | SDK connection health monitoring |

## Working implementation

We have a tested fork (~275 lines changed in `client.ts`) with all three features working in production. Happy to submit a PR.

### Bonus improvements in our fork

These are smaller quality-of-life fixes we found necessary for the `cliUrl` (external server) use case:

- **`resolveSessionForInboundRequest()`** — Fallback session resolution for inbound RPCs (`user_input.requested`, `permission.requested`) when the session ID doesn't match. Falls back to last foreground session → only active session.
- **`cliUrl` auth stripping** — Silently ignores `githubToken`/`useLoggedInUser` when connecting to external server (it manages its own auth) instead of throwing.
- **`getForegroundSessionId()`** — Queries the CLI's foreground session via `session.getForeground` RPC.
