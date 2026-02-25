// ============================================================================
// SignalForge Plugin API Context
// ============================================================================
import type { Express, Request, Response, NextFunction } from 'express';
import type { WebSocket } from 'ws';
import type Database from 'better-sqlite3';

export interface PluginRoute {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  handler: (req: Request, res: Response) => void;
}

export interface PluginManifestFile {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  icon?: string;
  provides: string[];
  requires: string[];
  config: Record<string, { type: string; required?: boolean; default?: any; description?: string }>;
}

export interface PluginContext {
  /** Register a REST route under /api/plugins/<pluginId>/... */
  registerRoute(method: 'get' | 'post' | 'put' | 'delete', path: string, handler: (req: Request, res: Response) => void): void;
  /** Register a WebSocket event handler */
  registerWebSocket(event: string, handler: (data: any, ws: WebSocket) => void): void;
  /** Access a core service by name */
  getService(name: string): any;
  /** Plugin-scoped logging */
  log(message: string): void;
  /** Read plugin config */
  getConfig(): Record<string, any>;
  /** Scoped SQLite database access (tables prefixed with plugin id) */
  db: PluginDB;
  /** Broadcast a message to all connected WebSocket clients */
  broadcast(data: any): void;
}

export interface PluginDB {
  exec(sql: string): void;
  prepare(sql: string): any;
  run(sql: string, ...params: any[]): any;
  get(sql: string, ...params: any[]): any;
  all(sql: string, ...params: any[]): any[];
}

export interface LoadedPlugin {
  id: string;
  manifest: PluginManifestFile;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  instance?: PluginInstance;
  config: Record<string, any>;
  routes: PluginRoute[];
  wsHandlers: Map<string, (data: any, ws: WebSocket) => void>;
}

export interface PluginInstance {
  activate?(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  onEvent?(event: string, data: any): void;
}

export function createPluginDB(db: Database.Database, pluginId: string): PluginDB {
  const prefix = pluginId.replace(/[^a-zA-Z0-9_]/g, '_');
  return {
    exec(sql: string) {
      // Auto-prefix table names isn't practical; plugins use scoped table names themselves
      db.exec(sql);
    },
    prepare(sql: string) {
      return db.prepare(sql);
    },
    run(sql: string, ...params: any[]) {
      return db.prepare(sql).run(...params);
    },
    get(sql: string, ...params: any[]) {
      return db.prepare(sql).get(...params);
    },
    all(sql: string, ...params: any[]) {
      return db.prepare(sql).all(...params);
    },
  };
}
