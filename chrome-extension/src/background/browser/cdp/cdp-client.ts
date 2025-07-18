import { DebuggerSession, ExecutionContextId, FrameId } from './types';

/**
 * CDPClient wraps a DebuggerSession and provides CDP command execution
 * for a specific debugging target (tab, iframe, or OOPIF)
 */
export class CDPClient {
  private isMainFrame: boolean = false;

  constructor(
    private debuggerSession: DebuggerSession,
    private frameId: FrameId,
    private executionContextId?: ExecutionContextId,
  ) {}

  /**
   * Send a CDP command to this debugging target
   */
  async sendCommand<T = any>(method: string, params?: any): Promise<T> {
    try {
      const result = await chrome.debugger.sendCommand(this.debuggerSession, method, params);
      return result as T;
    } catch (error) {
      console.error(`[CDPClient] Command failed: ${method}`, error);
      throw error;
    }
  }

  /**
   * Inject __nanoFrameId into the frame
   */
  async injectFrameId(): Promise<void> {
    try {
      console.log(`[CDPClient] Injecting __nanoFrameId="${this.frameId}"`);
      await this.evaluate(`window.__nanoFrameId = "${this.frameId}";`, false);
      console.log(`[CDPClient] Successfully injected __nanoFrameId for frame: ${this.frameId}`);
    } catch (error) {
      console.warn(`[CDPClient] Failed to inject __nanoFrameId for frame ${this.frameId}:`, error);
    }
  }

  /**
   * Evaluate a JavaScript expression in the target's execution context.
   *
   * @param expression The JavaScript source to evaluate.
   * @param returnByValue Whether to return the result by value (default true).
   * @returns The value produced by the expression when `returnByValue` is true, otherwise undefined.
   */
  async evaluate<T = any>(expression: string, returnByValue: boolean = true): Promise<T | undefined> {
    try {
      const params: any = {
        expression,
        returnByValue,
      };

      // Only add contextId for same-process iframes (not main frame or OOPIF)
      if (this.executionContextId !== undefined && !this.isMainFrame && !this.isOOPIF()) {
        params.contextId = this.executionContextId;
      }

      const { result } = await this.sendCommand<{ result: { value?: T } }>('Runtime.evaluate', params);

      // When returnByValue is true, the evaluated result is returned in result.value
      return result?.value as T | undefined;
    } catch (error) {
      console.error(`[CDPClient] Failed to evaluate expression "${expression}" in frame ${this.frameId}:`, error);
      throw error;
    }
  }

  /**
   * Set whether this client represents the main frame
   */
  setMainFrame(isMain: boolean): void {
    this.isMainFrame = isMain;
  }

  /**
   * Check if this client represents an Out-of-Process IFrame (OOPIF)
   */
  isOOPIF(): boolean {
    return this.debuggerSession.sessionId !== undefined;
  }

  /**
   * Get client info for display
   */
  getInfo(): {
    frameId: FrameId;
    sessionId?: string;
    executionContextId?: ExecutionContextId;
    type: 'main' | 'same-process-iframe' | 'oopif';
    isMainFrame: boolean;
  } {
    return {
      frameId: this.frameId,
      sessionId: this.debuggerSession.sessionId,
      executionContextId: this.executionContextId,
      type: this.isMainFrame ? 'main' : this.isOOPIF() ? 'oopif' : 'same-process-iframe',
      isMainFrame: this.isMainFrame,
    };
  }

  /**
   * Check if this client matches a specific debugger session
   */
  matchesSession(session: DebuggerSession): boolean {
    return this.debuggerSession.tabId === session.tabId && this.debuggerSession.sessionId === session.sessionId;
  }

  getFrameId(): FrameId {
    return this.frameId;
  }

  getDebuggerSession(): DebuggerSession {
    return this.debuggerSession;
  }
}
