// Chrome Debugger API types
export interface DebuggerSession {
  tabId: number;
  sessionId?: string; // Only present for child sessions (OOPIFs)
}

// Frame and CDP types
export type FrameId = string;
export type LoaderId = string;
export type ExecutionContextId = number;

export interface CdpFrame {
  id: FrameId;
  parentId?: FrameId;
  loaderId: LoaderId;
  name?: string;
  url: string;
  urlFragment?: string;
  domainAndRegistry?: string;
  securityOrigin: string;
  securityOriginDetails?: Record<string, unknown>;
  mimeType: string;
  unreachableUrl?: string;
  adFrameStatus?: string;
  secureContextType?: string;
  crossOriginIsolatedContextType?: string;
  gatedAPIFeatures?: string[];
}

export interface CdpFrameTree {
  frame: CdpFrame;
  childFrames?: CdpFrameTree[];
}

// Target info from Target.attachedToTarget event
export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  canAccessOpener: boolean;
  browserContextId?: string;
}

// Runtime execution context
export interface ExecutionContextDescription {
  id: ExecutionContextId;
  origin: string;
  name: string;
  uniqueId: string;
  auxData: {
    isDefault: boolean;
    type?: 'default' | 'isolated';
    frameId: FrameId;
  };
}

// CDP Client info for display
export interface CDPClientInfo {
  frameId: FrameId;
  url: string;
  type: 'main' | 'same-process-iframe' | 'oopif';
  sessionId?: string;
  executionContextId?: ExecutionContextId;
  isMainFrame?: boolean;
}

// Ping-pong message types for service worker keep-alive
export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}
