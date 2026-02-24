import { createServerRpc } from "./generated/rpc.js";
import { CopilotSession } from "./session.js";
import type { ConnectionState, ConnectionStateHandler, CopilotClientOptions, GetAuthStatusResponse, GetStatusResponse, ModelInfo, ResumeSessionConfig, SessionConfig, SessionEvent, SessionLifecycleEventType, SessionLifecycleHandler, SessionListFilter, SessionMetadata, TypedSessionLifecycleHandler } from "./types.js";
export declare class CopilotClient {
    private cliProcess;
    private connection;
    private socket;
    private actualPort;
    private actualHost;
    private state;
    private sessions;
    private options;
    private isExternalServer;
    private forceStopping;
    private modelsCache;
    private modelsCacheLock;
    private sessionLifecycleHandlers;
    private typedLifecycleHandlers;
    private lastForegroundSessionId?;
    private _rpc;
    private connectionStateHandlers;
    private userInputRequestHandlers;
    private userInputCompletedHandlers;
    private pendingAskUserCallIds;
    private sessionEventHandlers;
    /**
     * Typed server-scoped RPC methods.
     * @throws Error if the client is not connected
     */
    get rpc(): ReturnType<typeof createServerRpc>;
    /**
     * Creates a new CopilotClient instance.
     *
     * @param options - Configuration options for the client
     * @throws Error if mutually exclusive options are provided (e.g., cliUrl with useStdio or cliPath)
     *
     * @example
     * ```typescript
     * // Default options - spawns CLI server using stdio
     * const client = new CopilotClient();
     *
     * // Connect to an existing server
     * const client = new CopilotClient({ cliUrl: "localhost:3000" });
     *
     * // Custom CLI path with specific log level
     * const client = new CopilotClient({
     *   cliPath: "/usr/local/bin/copilot",
     *   logLevel: "debug"
     * });
     * ```
     */
    constructor(options?: CopilotClientOptions);
    /**
     * Parse CLI URL into host and port
     * Supports formats: "host:port", "http://host:port", "https://host:port", or just "port"
     */
    private parseCliUrl;
    /**
     * Starts the CLI server and establishes a connection.
     *
     * If connecting to an external server (via cliUrl), only establishes the connection.
     * Otherwise, spawns the CLI server process and then connects.
     *
     * This method is called automatically when creating a session if `autoStart` is true (default).
     *
     * @returns A promise that resolves when the connection is established
     * @throws Error if the server fails to start or the connection fails
     *
     * @example
     * ```typescript
     * const client = new CopilotClient({ autoStart: false });
     * await client.start();
     * // Now ready to create sessions
     * ```
     */
    start(): Promise<void>;
    /**
     * Stops the CLI server and closes all active sessions.
     *
     * This method performs graceful cleanup:
     * 1. Destroys all active sessions with retry logic
     * 2. Closes the JSON-RPC connection
     * 3. Terminates the CLI server process (if spawned by this client)
     *
     * @returns A promise that resolves with an array of errors encountered during cleanup.
     *          An empty array indicates all cleanup succeeded.
     *
     * @example
     * ```typescript
     * const errors = await client.stop();
     * if (errors.length > 0) {
     *   console.error("Cleanup errors:", errors);
     * }
     * ```
     */
    stop(): Promise<Error[]>;
    /**
     * Forcefully stops the CLI server without graceful cleanup.
     *
     * Use this when {@link stop} fails or takes too long. This method:
     * - Clears all sessions immediately without destroying them
     * - Force closes the connection
     * - Sends SIGKILL to the CLI process (if spawned by this client)
     *
     * @returns A promise that resolves when the force stop is complete
     *
     * @example
     * ```typescript
     * // If normal stop hangs, force stop
     * const stopPromise = client.stop();
     * const timeout = new Promise((_, reject) =>
     *   setTimeout(() => reject(new Error("Timeout")), 5000)
     * );
     *
     * try {
     *   await Promise.race([stopPromise, timeout]);
     * } catch {
     *   await client.forceStop();
     * }
     * ```
     */
    forceStop(): Promise<void>;
    /**
     * Creates a new conversation session with the Copilot CLI.
     *
     * Sessions maintain conversation state, handle events, and manage tool execution.
     * If the client is not connected and `autoStart` is enabled, this will automatically
     * start the connection.
     *
     * @param config - Optional configuration for the session
     * @returns A promise that resolves with the created session
     * @throws Error if the client is not connected and autoStart is disabled
     *
     * @example
     * ```typescript
     * // Basic session
     * const session = await client.createSession();
     *
     * // Session with model and tools
     * const session = await client.createSession({
     *   model: "gpt-4",
     *   tools: [{
     *     name: "get_weather",
     *     description: "Get weather for a location",
     *     parameters: { type: "object", properties: { location: { type: "string" } } },
     *     handler: async (args) => ({ temperature: 72 })
     *   }]
     * });
     * ```
     */
    createSession(config?: SessionConfig): Promise<CopilotSession>;
    /**
     * Resumes an existing conversation session by its ID.
     *
     * This allows you to continue a previous conversation, maintaining all
     * conversation history. The session must have been previously created
     * and not deleted.
     *
     * @param sessionId - The ID of the session to resume
     * @param config - Optional configuration for the resumed session
     * @returns A promise that resolves with the resumed session
     * @throws Error if the session does not exist or the client is not connected
     *
     * @example
     * ```typescript
     * // Resume a previous session
     * const session = await client.resumeSession("session-123");
     *
     * // Resume with new tools
     * const session = await client.resumeSession("session-123", {
     *   tools: [myNewTool]
     * });
     * ```
     */
    resumeSession(sessionId: string, config?: ResumeSessionConfig): Promise<CopilotSession>;
    /**
     * Gets the current connection state of the client.
     *
     * @returns The current connection state: "disconnected", "connecting", "connected", or "error"
     *
     * @example
     * ```typescript
     * if (client.getState() === "connected") {
     *   const session = await client.createSession();
     * }
     * ```
     */
    getState(): ConnectionState;
    /**
     * Subscribes to connection state change events.
     *
     * The handler is called whenever the client transitions between connection states
     * (disconnected, connecting, connected, error). This is useful for monitoring
     * the health of the CLI connection and updating UI accordingly.
     *
     * @param handler - A callback function that receives state change details
     * @returns A function that, when called, unsubscribes the handler
     *
     * @example
     * ```typescript
     * const unsubscribe = client.onConnectionStateChange((change) => {
     *   console.log(`${change.previousState} → ${change.currentState}`);
     *   if (change.reason) console.log(`Reason: ${change.reason}`);
     *   if (change.error) console.error(change.error);
     * });
     *
     * // Later, to stop receiving events:
     * unsubscribe();
     * ```
     */
    onConnectionStateChange(handler: ConnectionStateHandler): () => void;
    /**
     * Register a handler that fires when the server sends a user input request
     * (e.g., ask_user tool). This is a notification — the handler does NOT
     * provide the answer; it's for status tracking (e.g., showing "needs input").
     */
    onUserInputRequested(handler: (info: {
        sessionId: string;
        question: string;
        choices?: string[];
    }) => void): () => void;
    /**
     * Register a handler called when the user has answered an input request.
     * Fires after the response is sent back to the CLI (agent resumes processing).
     */
    onUserInputCompleted(handler: (info: {
        sessionId: string;
        answer: string;
    }) => void): () => void;
    /**
     * Register a handler for ALL session events (client-level, no session ID filtering).
     * This is useful when session.resume may return a different session ID than the
     * one the CLI uses for event notifications, causing session-level handlers to miss events.
     */
    onSessionEvent(handler: (sessionId: string, event: SessionEvent) => void): () => void;
    /**
     * Update connection state and notify all registered handlers.
     * Only dispatches if the state actually changes.
     */
    private setState;
    /**
     * Sends a ping request to the server to verify connectivity.
     *
     * @param message - Optional message to include in the ping
     * @returns A promise that resolves with the ping response containing the message and timestamp
     * @throws Error if the client is not connected
     *
     * @example
     * ```typescript
     * const response = await client.ping("health check");
     * console.log(`Server responded at ${new Date(response.timestamp)}`);
     * ```
     */
    ping(message?: string): Promise<{
        message: string;
        timestamp: number;
        protocolVersion?: number;
    }>;
    /**
     * Get CLI status including version and protocol information
     */
    getStatus(): Promise<GetStatusResponse>;
    /**
     * Get current authentication status
     */
    getAuthStatus(): Promise<GetAuthStatusResponse>;
    /**
     * List available models with their metadata.
     *
     * Results are cached after the first successful call to avoid rate limiting.
     * The cache is cleared when the client disconnects.
     *
     * @throws Error if not authenticated
     */
    listModels(): Promise<ModelInfo[]>;
    /**
     * Verify that the server's protocol version matches the SDK's expected version
     */
    private verifyProtocolVersion;
    /**
     * Gets the ID of the most recently updated session.
     *
     * This is useful for resuming the last conversation when the session ID
     * was not stored.
     *
     * @returns A promise that resolves with the session ID, or undefined if no sessions exist
     * @throws Error if the client is not connected
     *
     * @example
     * ```typescript
     * const lastId = await client.getLastSessionId();
     * if (lastId) {
     *   const session = await client.resumeSession(lastId);
     * }
     * ```
     */
    getLastSessionId(): Promise<string | undefined>;
    /**
     * Deletes a session and its data from disk.
     *
     * This permanently removes the session and all its conversation history.
     * The session cannot be resumed after deletion.
     *
     * @param sessionId - The ID of the session to delete
     * @returns A promise that resolves when the session is deleted
     * @throws Error if the session does not exist or deletion fails
     *
     * @example
     * ```typescript
     * await client.deleteSession("session-123");
     * ```
     */
    deleteSession(sessionId: string): Promise<void>;
    /**
     * List all available sessions.
     *
     * @param filter - Optional filter to limit returned sessions by context fields
     *
     * @example
     * // List all sessions
     * const sessions = await client.listSessions();
     *
     * @example
     * // List sessions for a specific repository
     * const sessions = await client.listSessions({ repository: "owner/repo" });
     */
    listSessions(filter?: SessionListFilter): Promise<SessionMetadata[]>;
    /**
     * Gets the foreground session ID in TUI+server mode.
     *
     * This returns the ID of the session currently displayed in the TUI.
     * Only available when connecting to a server running in TUI+server mode (--ui-server).
     *
     * @returns A promise that resolves with the foreground session ID, or undefined if none
     * @throws Error if the client is not connected
     *
     * @example
     * ```typescript
     * const sessionId = await client.getForegroundSessionId();
     * if (sessionId) {
     *   console.log(`TUI is displaying session: ${sessionId}`);
     * }
     * ```
     */
    getForegroundSessionId(): Promise<string | undefined>;
    /**
     * Sets the foreground session in TUI+server mode.
     *
     * This requests the TUI to switch to displaying the specified session.
     * Only available when connecting to a server running in TUI+server mode (--ui-server).
     *
     * @param sessionId - The ID of the session to display in the TUI
     * @returns A promise that resolves when the session is switched
     * @throws Error if the client is not connected or if the operation fails
     *
     * @example
     * ```typescript
     * // Switch the TUI to display a specific session
     * await client.setForegroundSessionId("session-123");
     * ```
     */
    setForegroundSessionId(sessionId: string): Promise<void>;
    /**
     * Subscribes to a specific session lifecycle event type.
     *
     * Lifecycle events are emitted when sessions are created, deleted, updated,
     * or change foreground/background state (in TUI+server mode).
     *
     * @param eventType - The specific event type to listen for
     * @param handler - A callback function that receives events of the specified type
     * @returns A function that, when called, unsubscribes the handler
     *
     * @example
     * ```typescript
     * // Listen for when a session becomes foreground in TUI
     * const unsubscribe = client.on("session.foreground", (event) => {
     *   console.log(`Session ${event.sessionId} is now displayed in TUI`);
     * });
     *
     * // Later, to stop receiving events:
     * unsubscribe();
     * ```
     */
    on<K extends SessionLifecycleEventType>(eventType: K, handler: TypedSessionLifecycleHandler<K>): () => void;
    /**
     * Subscribes to all session lifecycle events.
     *
     * @param handler - A callback function that receives all lifecycle events
     * @returns A function that, when called, unsubscribes the handler
     *
     * @example
     * ```typescript
     * const unsubscribe = client.on((event) => {
     *   switch (event.type) {
     *     case "session.foreground":
     *       console.log(`Session ${event.sessionId} is now in foreground`);
     *       break;
     *     case "session.created":
     *       console.log(`New session created: ${event.sessionId}`);
     *       break;
     *   }
     * });
     *
     * // Later, to stop receiving events:
     * unsubscribe();
     * ```
     */
    on(handler: SessionLifecycleHandler): () => void;
    /**
     * Start the CLI server process
     */
    private startCLIServer;
    /**
     * Connect to the CLI server (via socket or stdio)
     */
    private connectToServer;
    /**
     * Connect via stdio pipes
     */
    private connectViaStdio;
    /**
     * Connect to the CLI server via TCP socket
     */
    private connectViaTcp;
    private attachConnectionHandlers;
    private handleSessionEventNotification;
    private handleSessionLifecycleNotification;
    private handleToolCallRequest;
    private executeToolCall;
    private handlePermissionRequest;
    private handleUserInputRequest;
    private handleHooksInvoke;
    private normalizeToolResult;
    private isToolResultObject;
    private buildUnsupportedToolResult;
    /**
     * Resolve inbound requests that may carry a stale sessionId in TUI+server mode.
     */
    private resolveSessionForInboundRequest;
    /**
     * Attempt to reconnect to the server
     */
    private reconnect;
}
