import { CDPClient } from './cdp-client';
import {
  DebuggerSession,
  FrameId,
  ExecutionContextDescription,
  CDPClientInfo,
  TargetInfo,
  DebuggerEventSource,
} from './types';

/**
 * CDPSession manages all CDP clients for a single tab
 */
export class CDPSession {
  private clients = new Map<FrameId, CDPClient>();
  private tabId: number;
  private isInitialized: boolean = false;
  private mainFrameId: FrameId | null = null;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  /**
   * Initialize the main tab client and enable domains for event-driven discovery
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log(`[CDPSession] Already initialized for tab ${this.tabId}`);
      return;
    }

    console.log(`[CDPSession] Initializing for tab ${this.tabId}`);

    // Create main tab session for enabling domains
    const mainSession: DebuggerSession = { tabId: this.tabId };

    // Enable necessary domains
    await this.enableDomains(mainSession);

    // IMPORTANT: Detect main frame during initialization to ensure consistent session state
    // This fixes OOPIF re-attach issues by establishing a stable baseline before processing frame events
    await this.detectMainFrame();

    this.isInitialized = true;
    console.log(`[CDPSession] Initialization complete`);
  }

  /**
   * Enable CDP domains for the tab
   */
  private async enableDomains(session: DebuggerSession): Promise<void> {
    try {
      // Enable Runtime to get execution contexts
      await chrome.debugger.sendCommand(session, 'Runtime.enable');

      // Enable Page to get frame information
      await chrome.debugger.sendCommand(session, 'Page.enable');

      // Enable Target for OOPIF detection with auto-attach
      await chrome.debugger.sendCommand(session, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [
          { type: 'page', exclude: false },
          { type: 'iframe', exclude: false },
          // Exclude other target types
          { type: 'worker', exclude: true },
          { type: 'shared_worker', exclude: true },
          { type: 'service_worker', exclude: true },
          { type: 'browser', exclude: true },
          { type: 'tab', exclude: true },
        ],
      });

      console.log(`[CDPSession] Domains enabled for tab ${this.tabId}`);
    } catch (error) {
      console.warn('[CDPSession] Failed to enable some domains:', error);
    }
  }

  /**
   * Detect the main frame using Page.getFrameTree and update/create clients
   */
  async detectMainFrame(): Promise<void> {
    try {
      console.log(`[CDPSession] Detecting main frame via Page.getFrameTree`);

      const session: DebuggerSession = { tabId: this.tabId };
      const result = (await chrome.debugger.sendCommand(session, 'Page.getFrameTree')) as { frameTree: any };

      if (result && result.frameTree && result.frameTree.frame) {
        this.mainFrameId = result.frameTree.frame.id;
        console.log(`[CDPSession] Main frame detected: ${this.mainFrameId}`);

        if (this.mainFrameId) {
          // Check if we already have a client for the main frame
          const existingClient = this.clients.get(this.mainFrameId);
          if (existingClient) {
            // Update existing client's main frame flag
            existingClient.setMainFrame(true);
            console.log(`[CDPSession] Updated existing client as main frame: ${this.mainFrameId}`);
          } else {
            // Create new client for the main frame
            const mainClient = new CDPClient(session, this.mainFrameId);
            mainClient.setMainFrame(true);
            this.clients.set(this.mainFrameId, mainClient);
            console.log(`[CDPSession] Created new client for main frame: ${this.mainFrameId}`);

            // Inject frameId
            await mainClient.injectFrameId();
          }
        }
      } else {
        console.warn(`[CDPSession] No frame tree received from Page.getFrameTree`);
      }
    } catch (error) {
      console.error('[CDPSession] Failed to detect main frame:', error);
      throw error; // Re-throw to fail detection
    }
  }

  /**
   * Handle execution context created event
   */
  async handleExecutionContextCreated(
    context: ExecutionContextDescription,
    source: DebuggerEventSource,
  ): Promise<void> {
    const frameId = context.auxData?.frameId;
    if (!frameId) {
      console.log(`[CDPSession] Skipping context without frameId: ${context.name}`);
      return;
    }

    // Skip unwanted contexts but log what we're filtering
    if (this.shouldFilterContext(context)) {
      console.log(`[CDPSession] Filtering out context:`, {
        id: context.id,
        name: context.name,
        origin: context.origin,
        frameId: frameId,
      });
      return;
    }

    // Determine if this is an OOPIF context based on source.sessionId
    const isOOPIFContext = !!source.sessionId;

    if (isOOPIFContext) {
      console.log(`[CDPSession] OOPIF execution context created for frame: ${frameId}, sessionId: ${source.sessionId}`);

      // Check if we already have an OOPIF client for this frame
      const existingClient = this.clients.get(frameId);
      if (existingClient && existingClient.getInfo().sessionId === source.sessionId) {
        console.log(`[CDPSession] OOPIF client already exists for frame: ${frameId}`);
        return;
      }

      // Create OOPIF client with sessionId
      const session: DebuggerSession = { tabId: this.tabId, sessionId: source.sessionId };
      const client = new CDPClient(session, frameId, context.id);
      this.clients.set(frameId, client);

      console.log(`[CDPSession] Created OOPIF client for frame: ${frameId}`);

      // Inject frameId
      await client.injectFrameId();
    } else {
      // This is a same-process iframe context
      console.log(`[CDPSession] Same-process execution context created for frame: ${frameId}`);

      // Check if we already have a client for this frame
      const existingClient = this.clients.get(frameId);
      if (existingClient) {
        const info = existingClient.getInfo();
        // Update execution context if this is a same-process iframe without one
        if (!info.isMainFrame && !info.sessionId && !info.executionContextId) {
          console.log(`[CDPSession] Updating execution context for existing frame: ${frameId}`);
          existingClient.updateExecutionContext(context.id);
        } else {
          console.log(`[CDPSession] Client already fully configured for frame: ${frameId}`);
        }
        return;
      }

      console.log(`[CDPSession] Creating client for same-process frame: ${frameId}`);

      // Create client for same-process iframe with execution context
      const session: DebuggerSession = { tabId: this.tabId };
      const client = new CDPClient(session, frameId, context.id);
      this.clients.set(frameId, client);

      // Inject frameId
      await client.injectFrameId();
    }
  }

  /**
   * Handle OOPIF attachment
   */
  async handleTargetAttached(sessionId: string, targetInfo: TargetInfo, waitingForDebugger: boolean): Promise<void> {
    if (targetInfo.type !== 'iframe') return;

    // For OOPIFs of type iframe, the targetId is the frameId
    const frameId = targetInfo.targetId;
    console.log(`[CDPSession] Creating client for OOPIF: ${frameId}`);

    // Create client for OOPIF
    const session: DebuggerSession = { tabId: this.tabId, sessionId };
    const client = new CDPClient(session, frameId);
    this.clients.set(frameId, client);

    // Resume if waiting for debugger
    if (waitingForDebugger) {
      try {
        await client.sendCommand('Runtime.runIfWaitingForDebugger');
      } catch (error) {
        console.warn('[CDPSession] Failed to resume OOPIF:', error);
      }
    }

    // Enable auto-attach on child session for nested iframes
    await this.enableDomains(session);

    // Inject frameId
    await client.injectFrameId();
  }

  /**
   * Handle target detached
   */
  handleTargetDetached(sessionId: string): void {
    // Find and remove the client with this sessionId
    for (const [frameId, client] of this.clients.entries()) {
      if (client.getDebuggerSession().sessionId === sessionId) {
        console.log(`[CDPSession] Removing client for detached OOPIF: ${frameId}`);
        this.clients.delete(frameId);
        break;
      }
    }
  }

  /**
   * Handle execution context destroyed event
   */
  handleExecutionContextDestroyed(executionContextId: number): void {
    // Find and remove the client with this execution context ID
    for (const [frameId, client] of this.clients.entries()) {
      if (client.getInfo().executionContextId === executionContextId) {
        console.log(
          `[CDPSession] Removing client for destroyed context: ${frameId} (contextId: ${executionContextId})`,
        );
        this.clients.delete(frameId);
        break;
      }
    }
  }

  /**
   * Handle execution contexts cleared event (page refresh)
   */
  handleExecutionContextsCleared(): void {
    console.log(`[CDPSession] All execution contexts cleared - cleaning up same-process iframe clients`);
    // Remove all clients except OOPIFs (which have sessionId)
    const oopifsToKeep = new Map();
    for (const [frameId, client] of this.clients.entries()) {
      const info = client.getInfo();
      if (info.sessionId) {
        // Keep OOPIF clients
        oopifsToKeep.set(frameId, client);
        console.log(`[CDPSession] Keeping OOPIF client: ${frameId}`);
      } else {
        console.log(`[CDPSession] Removing same-process client: ${frameId}`);
      }
    }
    this.clients.clear();
    // Restore OOPIF clients
    for (const [frameId, client] of oopifsToKeep.entries()) {
      this.clients.set(frameId, client);
    }
  }

  /**
   * Handle frame navigated event
   */
  handleFrameNavigated(frame: any): void {
    const frameId = frame.id;
    console.log(`[CDPSession] Frame navigated: ${frameId}`);

    // For now, just log - we mainly rely on executionContextsCleared for cleanup
    // Individual frame navigation doesn't necessarily mean we should remove the client
    // as new execution contexts will be created for the same frame
  }

  /**
   * Check if a context should be filtered out
   */
  private shouldFilterContext(context: ExecutionContextDescription): boolean {
    // Filter out non-default execution worlds first.
    const isNotDefaultWorld = context.auxData?.isDefault === false;
    if (isNotDefaultWorld) {
      return true;
    }

    // If it’s the default world, apply origin-based filtering.
    const filteredOrigins = ['chrome-extension://', 'chrome://', 'devtools://', 'chrome-devtools://'];

    return filteredOrigins.some(prefix => context.origin.startsWith(prefix));
  }

  /**
   * Send command to a specific frame
   */
  async sendCommand(frameId: FrameId, method: string, params?: any): Promise<any> {
    const client = this.clients.get(frameId);
    if (!client) {
      throw new Error(`No client found for frame: ${frameId}`);
    }
    return client.sendCommand(method, params);
  }

  /**
   * Get CDP client for a specific frame, or main frame if no frameId provided
   */
  async getCDPClient(frameId?: FrameId): Promise<CDPClient | null> {
    // Ensure main frame is detected first
    if (!this.mainFrameId) {
      await this.detectMainFrame();
    }

    // If no frameId provided, get main frame client
    if (!frameId) {
      if (!this.mainFrameId) {
        console.warn(`[CDPSession] Failed to detect main frame for tab ${this.tabId}`);
        return null;
      }
      frameId = this.mainFrameId;
    }

    // Check if the requested frameId is the main frame
    const client = this.clients.get(frameId);
    if (client && this.mainFrameId && frameId === this.mainFrameId) {
      // Ensure the client is marked as main frame
      if (!client.getInfo().isMainFrame) {
        console.log(`[CDPSession] Marking client as main frame: ${frameId}`);
        client.setMainFrame(true);
      }
    }

    return client || null;
  }

  /**
   * Get all client info for display
   */
  async getAllClients(): Promise<CDPClientInfo[]> {
    console.log(
      `[CDPSession] getAllClients called for tab ${this.tabId}, current clients:`,
      Array.from(this.clients.keys()),
    );

    // Detect main frame if not already detected for proper client info
    if (!this.mainFrameId) {
      console.log(`[CDPSession] Main frame not detected yet, detecting now for getAllClients`);
      await this.detectMainFrame();
    }

    const clientInfos: CDPClientInfo[] = [];

    for (const [frameId, client] of this.clients.entries()) {
      const info = client.getInfo();

      // Check if this client is the main frame and mark it if needed
      if (this.mainFrameId && frameId === this.mainFrameId && !info.isMainFrame) {
        console.log(`[CDPSession] Marking existing client as main frame: ${frameId}`);
        client.setMainFrame(true);
      }

      // Try to get URL for this frame
      let url = 'unknown';
      if (info.type === 'main' || info.isMainFrame) {
        url = 'main frame';
      }

      clientInfos.push({
        frameId,
        url,
        type: info.type,
        sessionId: info.sessionId,
        executionContextId: info.executionContextId,
        isMainFrame: info.isMainFrame,
      });
    }

    console.log(`[CDPSession] Returning ${clientInfos.length} clients`);
    return clientInfos;
  }

  /**
   * Cleanup all clients
   */
  async cleanup(): Promise<void> {
    console.log(`[CDPSession] Cleaning up session for tab ${this.tabId}`);
    console.log(`[CDPSession] Current clients before cleanup:`, Array.from(this.clients.keys()));

    // Clear all clients
    this.clients.clear();

    console.log(`[CDPSession] Clients after clear:`, Array.from(this.clients.keys()));

    // Reset state
    this.isInitialized = false;
    this.mainFrameId = null;

    // Note: We don't disable CDP domains here because the debugger will be detached
    // by Puppeteer, which will automatically clean up all CDP state
  }

  getTabId(): number {
    return this.tabId;
  }
}
