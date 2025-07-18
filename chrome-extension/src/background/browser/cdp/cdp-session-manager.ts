import { CDPSession } from './cdp-session';
import { ExecutionContextDescription, TargetInfo, CDPClientInfo } from './types';

/**
 * Simplified CDPSessionManager that manages CDP sessions per tab
 * Puppeteer connections are now managed by Page class
 */
export class CDPSessionManager {
  private sessions = new Map<number, CDPSession>();

  constructor() {
    this.setupChromeListeners();
  }

  /**
   * Setup Chrome debugger event listeners
   */
  private setupChromeListeners(): void {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      this.handleDebuggerEvent(source, method, params);
    });

    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId) {
        console.log(`[CDPSessionManager] Debugger detached from tab ${source.tabId}, reason: ${reason}`);
        this.sessions.delete(source.tabId);
      }
    });
  }

  /**
   * Attach debugger to a tab (called after Puppeteer connection is established)
   */
  async attach(tabId: number): Promise<void> {
    if (this.sessions.has(tabId)) {
      console.log(`[CDPSessionManager] Already attached to tab ${tabId}`);
      return;
    }

    try {
      // Create and initialize the session
      const session = new CDPSession(tabId);
      this.sessions.set(tabId, session);

      // Initialize the session (this will enable domains and detect main frame)
      await session.initialize();

      console.log(`[CDPSessionManager] Session initialized for tab ${tabId}`);
    } catch (error) {
      console.error(`[CDPSessionManager] Failed to attach to tab ${tabId}:`, error);
      this.sessions.delete(tabId);
      throw error;
    }
  }

  /**
   * Detach debugger from a tab (Puppeteer cleanup handled by Page class)
   */
  async detach(tabId: number): Promise<void> {
    if (!this.sessions.has(tabId)) {
      console.log(`[CDPSessionManager] Not attached to tab ${tabId}`);
      return;
    }

    const session = this.sessions.get(tabId);
    if (session) {
      await session.cleanup();
      this.sessions.delete(tabId);
    }

    console.log(`[CDPSessionManager] Detached from tab ${tabId}`);
  }

  /**
   * Handle debugger events from Chrome
   */
  private handleDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params: any): void {
    // Uncomment for debugging:
    // console.log(`[CDPSessionManager] Debugger event: ${method} for tab ${source.tabId}`, {
    //   method,
    //   tabId: source.tabId,
    //   params: JSON.stringify(params, null, 2)
    // });

    if (!source.tabId) return;

    let session = this.sessions.get(source.tabId);
    if (!session) {
      // Create session if event arrives but session doesn't exist yet
      console.log(`[CDPSessionManager] Creating session for tab ${source.tabId} due to event: ${method}`);
      session = new CDPSession(source.tabId);
      this.sessions.set(source.tabId, session);
    }

    // Route events to the appropriate handler
    switch (method) {
      case 'Runtime.executionContextCreated':
        console.log(`[CDPSessionManager] ⚡ Runtime.executionContextCreated event for tab ${source.tabId}`);
        if (params.context) {
          session.handleExecutionContextCreated(params.context as ExecutionContextDescription);
        }
        break;

      case 'Runtime.executionContextDestroyed':
        console.log(`[CDPSessionManager] 💥 Runtime.executionContextDestroyed event for tab ${source.tabId}`);
        if (params.executionContextId) {
          session.handleExecutionContextDestroyed(params.executionContextId);
        }
        break;

      case 'Target.attachedToTarget':
        console.log(`[CDPSessionManager] 🎯 Target.attachedToTarget event for tab ${source.tabId}`);
        if (params.sessionId && params.targetInfo) {
          session.handleTargetAttached(
            params.sessionId,
            params.targetInfo as TargetInfo,
            params.waitingForDebugger || false,
          );
        }
        break;

      case 'Target.detachedFromTarget':
        console.log(`[CDPSessionManager] 🎯 Target.detachedFromTarget event for tab ${source.tabId}`);
        if (params.sessionId) {
          session.handleTargetDetached(params.sessionId);
        }
        break;

      case 'Runtime.executionContextsCleared':
        console.log(`[CDPSessionManager] 🧹 Runtime.executionContextsCleared event for tab ${source.tabId}`);
        session.handleExecutionContextsCleared();
        break;

      case 'Page.frameNavigated':
        console.log(`[CDPSessionManager] 🧭 Page.frameNavigated event for tab ${source.tabId}`);
        if (params.frame) {
          session.handleFrameNavigated(params.frame);
        }
        break;

      // We only handle the essential events
      // No need for frameAttached, frameDetached, etc.
      default:
        // Log other events for debugging
        if (method.startsWith('Runtime.') || method.startsWith('Target.') || method.startsWith('Page.')) {
          console.log(`[CDPSessionManager] Ignoring event: ${method}`);
        }
    }
  }

  /**
   * Check if debugger is attached to a tab
   */
  isAttached(tabId: number): boolean {
    return this.sessions.has(tabId);
  }

  /**
   * Get all CDP clients for a tab
   */
  getClients(tabId: number): CDPClientInfo[] {
    const session = this.sessions.get(tabId);
    return session ? session.getAllClients() : [];
  }

  /**
   * Send CDP command to a specific frame
   */
  async sendCommand(tabId: number, frameId: string, method: string, params?: any): Promise<any> {
    const session = this.sessions.get(tabId);
    if (!session) {
      throw new Error(`No session found for tab ${tabId}`);
    }
    return session.sendCommand(frameId, method, params);
  }

  /**
   * Get CDPSession for a tab
   */
  getSession(tabId: number): CDPSession | undefined {
    return this.sessions.get(tabId);
  }
}
