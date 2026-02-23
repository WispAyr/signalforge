// Phase 8: Multi-Window / Detachable Panels types

export interface DetachedPanel {
  id: string;
  viewType: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  windowId?: string;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  panels: DetachedPanel[];
  iconEmoji: string;
}

export interface MultiWindowMessage {
  type: 'state-update' | 'view-change' | 'data-sync' | 'command';
  source: string;
  payload: any;
  timestamp: number;
}
