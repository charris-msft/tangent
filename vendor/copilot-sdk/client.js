import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter
} from "vscode-jsonrpc/node.js";
import { createServerRpc } from "./generated/rpc.js";
import { getSdkProtocolVersion } from "./sdkProtocolVersion.js";
import { CopilotSession } from "./session.js";
function isZodSchema(value) {
  return value != null && typeof value === "object" && "toJSONSchema" in value && typeof value.toJSONSchema === "function";
}
function toJsonSchema(parameters) {
  if (!parameters) return void 0;
  if (isZodSchema(parameters)) {
    return parameters.toJSONSchema();
  }
  return parameters;
}
function getBundledCliPath() {
  const sdkUrl = import.meta.resolve("@github/copilot/sdk");
  const sdkPath = fileURLToPath(sdkUrl);
  return join(dirname(dirname(sdkPath)), "index.js");
}
class CopilotClient {
  cliProcess = null;
  connection = null;
  socket = null;
  actualPort = null;
  actualHost = "localhost";
  state = "disconnected";
  sessions = /* @__PURE__ */ new Map();
  options;
  isExternalServer = false;
  forceStopping = false;
  modelsCache = null;
  modelsCacheLock = Promise.resolve();
  sessionLifecycleHandlers = /* @__PURE__ */ new Set();
  typedLifecycleHandlers = /* @__PURE__ */ new Map();
  lastForegroundSessionId;
  _rpc = null;
  connectionStateHandlers = /* @__PURE__ */ new Set();
  userInputRequestHandlers = /* @__PURE__ */ new Set();
  userInputCompletedHandlers = /* @__PURE__ */ new Set();
  pendingAskUserCallIds = /* @__PURE__ */ new Set();
  sessionEventHandlers = /* @__PURE__ */ new Set();
  /**
   * Typed server-scoped RPC methods.
   * @throws Error if the client is not connected
   */
  get rpc() {
    if (!this.connection) {
      throw new Error("Client is not connected. Call start() first.");
    }
    if (!this._rpc) {
      this._rpc = createServerRpc(this.connection);
    }
    return this._rpc;
  }
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
  constructor(options = {}) {
    if (options.cliUrl && (options.useStdio === true || options.cliPath)) {
      throw new Error("cliUrl is mutually exclusive with useStdio and cliPath");
    }
    if (options.cliUrl) {
      if (options.githubToken || options.useLoggedInUser !== void 0) {
        options = { ...options };
        delete options.githubToken;
        delete options.useLoggedInUser;
      }
    }
    if (options.cliUrl) {
      const { host, port } = this.parseCliUrl(options.cliUrl);
      this.actualHost = host;
      this.actualPort = port;
      this.isExternalServer = true;
    }
    this.options = {
      cliPath: options.cliUrl ? "" : options.cliPath || getBundledCliPath(),
      cliArgs: options.cliArgs ?? [],
      cwd: options.cwd ?? process.cwd(),
      port: options.port || 0,
      useStdio: options.cliUrl ? false : options.useStdio ?? true,
      // Default to stdio unless cliUrl is provided
      cliUrl: options.cliUrl,
      logLevel: options.logLevel || "debug",
      autoStart: options.autoStart ?? true,
      autoRestart: options.autoRestart ?? true,
      env: options.env ?? process.env,
      githubToken: options.githubToken,
      // Default useLoggedInUser to false when githubToken is provided, otherwise true
      useLoggedInUser: options.useLoggedInUser ?? (options.githubToken ? false : true)
    };
  }
  /**
   * Parse CLI URL into host and port
   * Supports formats: "host:port", "http://host:port", "https://host:port", or just "port"
   */
  parseCliUrl(url) {
    let cleanUrl = url.replace(/^https?:\/\//, "");
    if (/^\d+$/.test(cleanUrl)) {
      return { host: "localhost", port: parseInt(cleanUrl, 10) };
    }
    const parts = cleanUrl.split(":");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid cliUrl format: ${url}. Expected "host:port", "http://host:port", or "port"`
      );
    }
    const host = parts[0] || "localhost";
    const port = parseInt(parts[1], 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid port in cliUrl: ${url}`);
    }
    return { host, port };
  }
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
  async start() {
    if (this.state === "connected") {
      return;
    }
    this.setState("connecting");
    try {
      if (!this.isExternalServer) {
        await this.startCLIServer();
      }
      await this.connectToServer();
      await this.verifyProtocolVersion();
      this.setState("connected");
    } catch (error) {
      this.setState("error", {
        reason: "start_failed",
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }
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
  async stop() {
    const errors = [];
    for (const session of this.sessions.values()) {
      const sessionId = session.sessionId;
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await session.destroy();
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < 3) {
            const delay = 100 * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      if (lastError) {
        errors.push(
          new Error(
            `Failed to destroy session ${sessionId} after 3 attempts: ${lastError.message}`
          )
        );
      }
    }
    this.sessions.clear();
    this.lastForegroundSessionId = void 0;
    if (this.connection) {
      try {
        this.connection.dispose();
      } catch (error) {
        errors.push(
          new Error(
            `Failed to dispose connection: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
      this.connection = null;
      this._rpc = null;
    }
    this.modelsCache = null;
    if (this.socket) {
      try {
        this.socket.end();
      } catch (error) {
        errors.push(
          new Error(
            `Failed to close socket: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
      this.socket = null;
    }
    if (this.cliProcess && !this.isExternalServer) {
      try {
        this.cliProcess.kill();
      } catch (error) {
        errors.push(
          new Error(
            `Failed to kill CLI process: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
      this.cliProcess = null;
    }
    this.setState("disconnected", { reason: "stopped" });
    this.actualPort = null;
    return errors;
  }
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
  async forceStop() {
    this.forceStopping = true;
    this.sessions.clear();
    this.lastForegroundSessionId = void 0;
    if (this.connection) {
      try {
        this.connection.dispose();
      } catch {
      }
      this.connection = null;
      this._rpc = null;
    }
    this.modelsCache = null;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
      }
      this.socket = null;
    }
    if (this.cliProcess && !this.isExternalServer) {
      try {
        this.cliProcess.kill("SIGKILL");
      } catch {
      }
      this.cliProcess = null;
    }
    this.setState("disconnected", { reason: "force_stopped" });
    this.actualPort = null;
  }
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
  async createSession(config = {}) {
    if (!this.connection) {
      if (this.options.autoStart) {
        await this.start();
      } else {
        throw new Error("Client not connected. Call start() first.");
      }
    }
    const response = await this.connection.sendRequest("session.create", {
      model: config.model,
      sessionId: config.sessionId,
      reasoningEffort: config.reasoningEffort,
      tools: config.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toJsonSchema(tool.parameters)
      })),
      systemMessage: config.systemMessage,
      availableTools: config.availableTools,
      excludedTools: config.excludedTools,
      provider: config.provider,
      requestPermission: !!config.onPermissionRequest,
      requestUserInput: !!config.onUserInputRequest,
      hooks: !!(config.hooks && Object.values(config.hooks).some(Boolean)),
      workingDirectory: config.workingDirectory,
      streaming: config.streaming,
      mcpServers: config.mcpServers,
      customAgents: config.customAgents,
      configDir: config.configDir,
      skillDirectories: config.skillDirectories,
      disabledSkills: config.disabledSkills,
      infiniteSessions: config.infiniteSessions
    });
    const { sessionId, workspacePath } = response;
    const session = new CopilotSession(sessionId, this.connection, workspacePath);
    session.registerTools(config.tools);
    if (config.onPermissionRequest) {
      session.registerPermissionHandler(config.onPermissionRequest);
    }
    if (config.onUserInputRequest) {
      session.registerUserInputHandler(config.onUserInputRequest);
    }
    if (config.hooks) {
      session.registerHooks(config.hooks);
    }
    this.sessions.set(sessionId, session);
    this.lastForegroundSessionId = sessionId;
    return session;
  }
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
  async resumeSession(sessionId, config = {}) {
    if (!this.connection) {
      if (this.options.autoStart) {
        await this.start();
      } else {
        throw new Error("Client not connected. Call start() first.");
      }
    }
    const response = await this.connection.sendRequest("session.resume", {
      sessionId,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      systemMessage: config.systemMessage,
      availableTools: config.availableTools,
      excludedTools: config.excludedTools,
      tools: config.tools?.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toJsonSchema(tool.parameters)
      })),
      provider: config.provider,
      requestPermission: !!config.onPermissionRequest,
      requestUserInput: !!config.onUserInputRequest,
      hooks: !!(config.hooks && Object.values(config.hooks).some(Boolean)),
      workingDirectory: config.workingDirectory,
      configDir: config.configDir,
      streaming: config.streaming,
      mcpServers: config.mcpServers,
      customAgents: config.customAgents,
      skillDirectories: config.skillDirectories,
      disabledSkills: config.disabledSkills,
      infiniteSessions: config.infiniteSessions,
      disableResume: config.disableResume
    });
    const { sessionId: resumedSessionId, workspacePath } = response;
    const session = new CopilotSession(resumedSessionId, this.connection, workspacePath);
    session.registerTools(config.tools);
    if (config.onPermissionRequest) {
      session.registerPermissionHandler(config.onPermissionRequest);
    }
    if (config.onUserInputRequest) {
      session.registerUserInputHandler(config.onUserInputRequest);
    }
    if (config.hooks) {
      session.registerHooks(config.hooks);
    }
    this.sessions.set(resumedSessionId, session);
    this.lastForegroundSessionId = resumedSessionId;
    return session;
  }
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
  getState() {
    return this.state;
  }
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
  onConnectionStateChange(handler) {
    this.connectionStateHandlers.add(handler);
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }
  /**
   * Register a handler that fires when the server sends a user input request
   * (e.g., ask_user tool). This is a notification — the handler does NOT
   * provide the answer; it's for status tracking (e.g., showing "needs input").
   */
  onUserInputRequested(handler) {
    this.userInputRequestHandlers.add(handler);
    return () => {
      this.userInputRequestHandlers.delete(handler);
    };
  }
  /**
   * Register a handler called when the user has answered an input request.
   * Fires after the response is sent back to the CLI (agent resumes processing).
   */
  onUserInputCompleted(handler) {
    this.userInputCompletedHandlers.add(handler);
    return () => {
      this.userInputCompletedHandlers.delete(handler);
    };
  }
  /**
   * Register a handler for ALL session events (client-level, no session ID filtering).
   * This is useful when session.resume may return a different session ID than the
   * one the CLI uses for event notifications, causing session-level handlers to miss events.
   */
  onSessionEvent(handler) {
    this.sessionEventHandlers.add(handler);
    return () => {
      this.sessionEventHandlers.delete(handler);
    };
  }
  /**
   * Update connection state and notify all registered handlers.
   * Only dispatches if the state actually changes.
   */
  setState(newState, options) {
    const previousState = this.state;
    if (previousState === newState) {
      return;
    }
    this.state = newState;
    const change = {
      previousState,
      currentState: newState,
      reason: options?.reason,
      error: options?.error
    };
    for (const handler of this.connectionStateHandlers) {
      try {
        handler(change);
      } catch {
      }
    }
  }
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
  async ping(message) {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    const result = await this.connection.sendRequest("ping", { message });
    return result;
  }
  /**
   * Get CLI status including version and protocol information
   */
  async getStatus() {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    const result = await this.connection.sendRequest("status.get", {});
    return result;
  }
  /**
   * Get current authentication status
   */
  async getAuthStatus() {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    const result = await this.connection.sendRequest("auth.getStatus", {});
    return result;
  }
  /**
   * List available models with their metadata.
   *
   * Results are cached after the first successful call to avoid rate limiting.
   * The cache is cleared when the client disconnects.
   *
   * @throws Error if not authenticated
   */
  async listModels() {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    await this.modelsCacheLock;
    let resolveLock;
    this.modelsCacheLock = new Promise((resolve) => {
      resolveLock = resolve;
    });
    try {
      if (this.modelsCache !== null) {
        return [...this.modelsCache];
      }
      const result = await this.connection.sendRequest("models.list", {});
      const response = result;
      const models = response.models;
      this.modelsCache = models;
      return [...models];
    } finally {
      resolveLock();
    }
  }
  /**
   * Verify that the server's protocol version matches the SDK's expected version
   */
  async verifyProtocolVersion() {
    const expectedVersion = getSdkProtocolVersion();
    const pingResult = await this.ping();
    const serverVersion = pingResult.protocolVersion;
    if (serverVersion === void 0) {
      throw new Error(
        `SDK protocol version mismatch: SDK expects version ${expectedVersion}, but server does not report a protocol version. Please update your server to ensure compatibility.`
      );
    }
    if (serverVersion !== expectedVersion) {
      throw new Error(
        `SDK protocol version mismatch: SDK expects version ${expectedVersion}, but server reports version ${serverVersion}. Please update your SDK or server to ensure compatibility.`
      );
    }
  }
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
  async getLastSessionId() {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    const response = await this.connection.sendRequest("session.getLastId", {});
    return response.sessionId;
  }
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
  async deleteSession(sessionId) {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    const response = await this.connection.sendRequest("session.delete", {
      sessionId
    });
    const { success, error } = response;
    if (!success) {
      throw new Error(`Failed to delete session ${sessionId}: ${error || "Unknown error"}`);
    }
    this.sessions.delete(sessionId);
    if (this.lastForegroundSessionId === sessionId) {
      this.lastForegroundSessionId = void 0;
    }
  }
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
  async listSessions(filter) {
    if (!this.connection) {
      if (this.options.autoStart) {
        await this.start();
      } else {
        throw new Error("Client not connected. Call start() first.");
      }
    }
    const response = await this.connection.sendRequest("session.list", { filter });
    const { sessions } = response;
    return sessions.map((s) => ({
      sessionId: s.sessionId,
      startTime: new Date(s.startTime),
      modifiedTime: new Date(s.modifiedTime),
      summary: s.summary,
      isRemote: s.isRemote,
      context: s.context
    }));
  }
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
  async getForegroundSessionId() {
    if (!this.connection) {
      if (this.options.autoStart) {
        await this.start();
      } else {
        throw new Error("Client not connected. Call start() first.");
      }
    }
    const response = await this.connection.sendRequest("session.getForeground", {});
    return response.sessionId;
  }
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
  async setForegroundSessionId(sessionId) {
    if (!this.connection) {
      throw new Error("Client not connected");
    }
    const response = await this.connection.sendRequest("session.setForeground", { sessionId });
    const result = response;
    if (!result.success) {
      throw new Error(result.error || "Failed to set foreground session");
    }
  }
  on(eventTypeOrHandler, handler) {
    if (typeof eventTypeOrHandler === "string" && handler) {
      const eventType = eventTypeOrHandler;
      if (!this.typedLifecycleHandlers.has(eventType)) {
        this.typedLifecycleHandlers.set(eventType, /* @__PURE__ */ new Set());
      }
      const storedHandler = handler;
      this.typedLifecycleHandlers.get(eventType).add(storedHandler);
      return () => {
        const handlers = this.typedLifecycleHandlers.get(eventType);
        if (handlers) {
          handlers.delete(storedHandler);
        }
      };
    }
    const wildcardHandler = eventTypeOrHandler;
    this.sessionLifecycleHandlers.add(wildcardHandler);
    return () => {
      this.sessionLifecycleHandlers.delete(wildcardHandler);
    };
  }
  /**
   * Start the CLI server process
   */
  async startCLIServer() {
    return new Promise((resolve, reject) => {
      const args = [
        ...this.options.cliArgs,
        "--headless",
        "--no-auto-update",
        "--log-level",
        this.options.logLevel
      ];
      if (this.options.useStdio) {
        args.push("--stdio");
      } else if (this.options.port > 0) {
        args.push("--port", this.options.port.toString());
      }
      if (this.options.githubToken) {
        args.push("--auth-token-env", "COPILOT_SDK_AUTH_TOKEN");
      }
      if (!this.options.useLoggedInUser) {
        args.push("--no-auto-login");
      }
      const envWithoutNodeDebug = { ...this.options.env };
      delete envWithoutNodeDebug.NODE_DEBUG;
      if (this.options.githubToken) {
        envWithoutNodeDebug.COPILOT_SDK_AUTH_TOKEN = this.options.githubToken;
      }
      if (!existsSync(this.options.cliPath)) {
        throw new Error(
          `Copilot CLI not found at ${this.options.cliPath}. Ensure @github/copilot is installed.`
        );
      }
      const stdioConfig = this.options.useStdio ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
      const isJsFile = this.options.cliPath.endsWith(".js");
      if (isJsFile) {
        this.cliProcess = spawn(process.execPath, [this.options.cliPath, ...args], {
          stdio: stdioConfig,
          cwd: this.options.cwd,
          env: envWithoutNodeDebug,
          windowsHide: true
        });
      } else {
        this.cliProcess = spawn(this.options.cliPath, args, {
          stdio: stdioConfig,
          cwd: this.options.cwd,
          env: envWithoutNodeDebug,
          windowsHide: true
        });
      }
      let stdout = "";
      let resolved = false;
      if (this.options.useStdio) {
        resolved = true;
        resolve();
      } else {
        this.cliProcess.stdout?.on("data", (data) => {
          stdout += data.toString();
          const match = stdout.match(/listening on port (\d+)/i);
          if (match && !resolved) {
            this.actualPort = parseInt(match[1], 10);
            resolved = true;
            resolve();
          }
        });
      }
      this.cliProcess.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            process.stderr.write(`[CLI subprocess] ${line}
`);
          }
        }
      });
      this.cliProcess.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to start CLI server: ${error.message}`));
        } else {
          this.setState("error", {
            reason: "process_error",
            error
          });
        }
      });
      this.cliProcess.on("exit", (code) => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`CLI server exited with code ${code}`));
        } else if (this.options.autoRestart && this.state === "connected") {
          void this.reconnect();
        } else if (this.state === "connected") {
          this.setState("disconnected", {
            reason: `process_exited (code ${code})`
          });
        }
      });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("Timeout waiting for CLI server to start"));
        }
      }, 1e4);
    });
  }
  /**
   * Connect to the CLI server (via socket or stdio)
   */
  async connectToServer() {
    if (this.options.useStdio) {
      return this.connectViaStdio();
    } else {
      return this.connectViaTcp();
    }
  }
  /**
   * Connect via stdio pipes
   */
  async connectViaStdio() {
    if (!this.cliProcess) {
      throw new Error("CLI process not started");
    }
    this.cliProcess.stdin?.on("error", (err) => {
      if (!this.forceStopping) {
        throw err;
      }
    });
    this.connection = createMessageConnection(
      new StreamMessageReader(this.cliProcess.stdout),
      new StreamMessageWriter(this.cliProcess.stdin)
    );
    this.attachConnectionHandlers();
    this.connection.listen();
  }
  /**
   * Connect to the CLI server via TCP socket
   */
  async connectViaTcp() {
    if (!this.actualPort) {
      throw new Error("Server port not available");
    }
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.connect(this.actualPort, this.actualHost, () => {
        this.connection = createMessageConnection(
          new StreamMessageReader(this.socket),
          new StreamMessageWriter(this.socket)
        );
        this.attachConnectionHandlers();
        this.connection.listen();
        resolve();
      });
      this.socket.on("error", (error) => {
        reject(new Error(`Failed to connect to CLI server: ${error.message}`));
      });
    });
  }
  attachConnectionHandlers() {
    if (!this.connection) {
      return;
    }
    this.connection.onNotification("session.event", (notification) => {
      this.handleSessionEventNotification(notification);
    });
    this.connection.onNotification("session.lifecycle", (notification) => {
      this.handleSessionLifecycleNotification(notification);
    });
    this.connection.onRequest(
      "tool.call",
      async (params) => await this.handleToolCallRequest(params)
    );
    this.connection.onRequest(
      "permission.request",
      async (params) => await this.handlePermissionRequest(params)
    );
    this.connection.onRequest(
      "userInput.request",
      async (params) => await this.handleUserInputRequest(params)
    );
    this.connection.onRequest(
      "hooks.invoke",
      async (params) => await this.handleHooksInvoke(params)
    );
    this.connection.onClose(() => {
      if (this.state === "connected" && this.options.autoRestart) {
        void this.reconnect();
      } else if (this.state === "connected") {
        this.setState("disconnected", { reason: "connection_closed" });
      }
    });
    this.connection.onError((error) => {
      if (this.state === "connected") {
        this.setState("error", {
          reason: "connection_error",
          error: error[0] instanceof Error ? error[0] : new Error(String(error[0]))
        });
      }
    });
  }
  handleSessionEventNotification(notification) {
    if (typeof notification !== "object" || !notification || !("sessionId" in notification) || typeof notification.sessionId !== "string" || !("event" in notification)) {
      return;
    }
    const sessionId = notification.sessionId;
    const event = notification.event;
    const data = event.data;
    if (event.type === "tool.execution_start" && data?.toolName === "ask_user") {
      const toolCallId = data?.toolCallId;
      if (toolCallId) this.pendingAskUserCallIds.add(toolCallId);
      const args = data?.arguments;
      const question = args?.question ?? "User input requested";
      for (const handler of this.userInputRequestHandlers) {
        try {
          handler({ sessionId, question });
        } catch {
        }
      }
    }
    if (event.type === "tool.execution_complete") {
      const toolCallId = data?.toolCallId;
      if (toolCallId && this.pendingAskUserCallIds.delete(toolCallId)) {
        const rawResult = data?.result;
        const answer = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult) ?? "";
        for (const handler of this.userInputCompletedHandlers) {
          try {
            handler({ sessionId, answer });
          } catch {
          }
        }
      }
    }
    const session = this.sessions.get(sessionId);
    if (session) {
      session._dispatchEvent(event);
    }
    for (const handler of this.sessionEventHandlers) {
      try {
        handler(sessionId, event);
      } catch {
      }
    }
  }
  handleSessionLifecycleNotification(notification) {
    if (typeof notification !== "object" || !notification || !("type" in notification) || typeof notification.type !== "string" || !("sessionId" in notification) || typeof notification.sessionId !== "string") {
      return;
    }
    const event = notification;
    if (event.type === "session.foreground") {
      this.lastForegroundSessionId = event.sessionId;
    }
    const typedHandlers = this.typedLifecycleHandlers.get(event.type);
    if (typedHandlers) {
      for (const handler of typedHandlers) {
        try {
          handler(event);
        } catch {
        }
      }
    }
    for (const handler of this.sessionLifecycleHandlers) {
      try {
        handler(event);
      } catch {
      }
    }
  }
  async handleToolCallRequest(params) {
    if (!params || typeof params.sessionId !== "string" || typeof params.toolCallId !== "string" || typeof params.toolName !== "string") {
      throw new Error("Invalid tool call payload");
    }
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }
    const handler = session.getToolHandler(params.toolName);
    if (!handler) {
      return { result: this.buildUnsupportedToolResult(params.toolName) };
    }
    return await this.executeToolCall(handler, params);
  }
  async executeToolCall(handler, request) {
    try {
      const invocation = {
        sessionId: request.sessionId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        arguments: request.arguments
      };
      const result = await handler(request.arguments, invocation);
      return { result: this.normalizeToolResult(result) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: {
          // Don't expose detailed error information to the LLM for security reasons
          textResultForLlm: "Invoking this tool produced an error. Detailed information is not available.",
          resultType: "failure",
          error: message,
          toolTelemetry: {}
        }
      };
    }
  }
  async handlePermissionRequest(params) {
    if (!params || typeof params.sessionId !== "string" || !params.permissionRequest) {
      throw new Error("Invalid permission request payload");
    }
    const session = this.resolveSessionForInboundRequest(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    try {
      const result = await session._handlePermissionRequest(params.permissionRequest);
      return { result };
    } catch (_error) {
      return {
        result: {
          kind: "denied-no-approval-rule-and-could-not-request-from-user"
        }
      };
    }
  }
  async handleUserInputRequest(params) {
    if (!params || typeof params.sessionId !== "string" || typeof params.question !== "string") {
      throw new Error("Invalid user input request payload");
    }
    for (const handler of this.userInputRequestHandlers) {
      try {
        handler({ sessionId: params.sessionId, question: params.question, choices: params.choices });
      } catch {
      }
    }
    const session = this.resolveSessionForInboundRequest(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    const result = await session._handleUserInputRequest({
      question: params.question,
      choices: params.choices,
      allowFreeform: params.allowFreeform
    });
    for (const handler of this.userInputCompletedHandlers) {
      try {
        handler({ sessionId: params.sessionId, answer: result.answer });
      } catch {
      }
    }
    return result;
  }
  async handleHooksInvoke(params) {
    if (!params || typeof params.sessionId !== "string" || typeof params.hookType !== "string") {
      throw new Error("Invalid hooks invoke payload");
    }
    const session = this.resolveSessionForInboundRequest(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    const output = await session._handleHooksInvoke(params.hookType, params.input);
    return { output };
  }
  normalizeToolResult(result) {
    if (result === void 0 || result === null) {
      return {
        textResultForLlm: "Tool returned no result",
        resultType: "failure",
        error: "tool returned no result",
        toolTelemetry: {}
      };
    }
    if (this.isToolResultObject(result)) {
      return result;
    }
    const textResult = typeof result === "string" ? result : JSON.stringify(result);
    return {
      textResultForLlm: textResult,
      resultType: "success",
      toolTelemetry: {}
    };
  }
  isToolResultObject(value) {
    return typeof value === "object" && value !== null && "textResultForLlm" in value && typeof value.textResultForLlm === "string" && "resultType" in value;
  }
  buildUnsupportedToolResult(toolName) {
    return {
      textResultForLlm: `Tool '${toolName}' is not supported by this client instance.`,
      resultType: "failure",
      error: `tool '${toolName}' not supported`,
      toolTelemetry: {}
    };
  }
  /**
   * Resolve inbound requests that may carry a stale sessionId in TUI+server mode.
   */
  resolveSessionForInboundRequest(sessionId) {
    const direct = this.sessions.get(sessionId);
    if (direct) {
      return direct;
    }
    if (this.lastForegroundSessionId) {
      const foreground = this.sessions.get(this.lastForegroundSessionId);
      if (foreground) {
        return foreground;
      }
    }
    if (this.sessions.size === 1) {
      return this.sessions.values().next().value;
    }
    return void 0;
  }
  /**
   * Attempt to reconnect to the server
   */
  async reconnect() {
    this.setState("disconnected", { reason: "connection_lost" });
    try {
      await this.stop();
      this.setState("connecting", { reason: "reconnecting" });
      await this.start();
    } catch (error) {
      this.setState("error", {
        reason: "reconnect_failed",
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }
}
export {
  CopilotClient
};
