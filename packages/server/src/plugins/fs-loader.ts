// ============================================================================
// SignalForge Filesystem Plugin Loader
// ============================================================================
import { EventEmitter } from 'events';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type { Express, Request, Response } from 'express';
import type { WebSocket } from 'ws';
import type Database from 'better-sqlite3';
import {
  createPluginDB,
  type PluginManifestFile,
  type PluginContext,
  type LoadedPlugin,
  type PluginInstance,
  type PluginRoute,
} from './context.js';

export class FilesystemPluginLoader extends EventEmitter {
  private plugins = new Map<string, LoadedPlugin>();
  private pluginsDir: string;
  private configDir: string;
  private db: Database.Database;
  private services: Map<string, any>;
  private broadcastFn: (data: any) => void;

  constructor(
    pluginsDir: string,
    db: Database.Database,
    services: Map<string, any>,
    broadcastFn: (data: any) => void,
  ) {
    super();
    this.pluginsDir = pluginsDir;
    this.configDir = join(pluginsDir, '..', 'config', 'plugins');
    this.db = db;
    this.services = services;
    this.broadcastFn = broadcastFn;

    // Ensure directories exist
    if (!existsSync(this.pluginsDir)) mkdirSync(this.pluginsDir, { recursive: true });
    if (!existsSync(this.configDir)) mkdirSync(this.configDir, { recursive: true });

    // Create plugin config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_config (
        plugin_id TEXT PRIMARY KEY,
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `);
  }

  /** Scan plugins directory and load all valid plugins */
  async scanAndLoad(): Promise<void> {
    if (!existsSync(this.pluginsDir)) return;

    const dirs = readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const manifestPath = join(this.pluginsDir, dir.name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest: PluginManifestFile = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.id = manifest.id || dir.name;
        await this.loadPlugin(dir.name, manifest);
      } catch (err: any) {
        console.error(`⚠️ Plugin ${dir.name}: failed to read manifest — ${err.message}`);
      }
    }

    console.log(`🔌 Loaded ${this.plugins.size} filesystem plugins`);
  }

  private async loadPlugin(dirName: string, manifest: PluginManifestFile): Promise<void> {
    const plugin: LoadedPlugin = {
      id: manifest.id,
      manifest,
      enabled: true,
      loaded: false,
      config: this.loadConfig(manifest.id, manifest.config),
      routes: [],
      wsHandlers: new Map(),
    };

    // Check enabled state from DB
    const dbRow = this.db.prepare('SELECT enabled FROM plugin_config WHERE plugin_id = ?').get(manifest.id) as any;
    if (dbRow && dbRow.enabled === 0) {
      plugin.enabled = false;
    }

    this.plugins.set(manifest.id, plugin);

    if (!plugin.enabled) {
      console.log(`🔌 Plugin ${manifest.name} (disabled)`);
      return;
    }

    // Try to load the entry file
    const entryPath = join(this.pluginsDir, dirName, manifest.entry);
    if (!existsSync(entryPath)) {
      plugin.error = `Entry file not found: ${manifest.entry}`;
      console.error(`⚠️ Plugin ${manifest.name}: ${plugin.error}`);
      return;
    }

    try {
      const entryUrl = pathToFileURL(entryPath).href;
      const mod = await import(entryUrl);
      const PluginClass = mod.default || mod;

      const instance: PluginInstance = typeof PluginClass === 'function'
        ? new PluginClass()
        : PluginClass;

      plugin.instance = instance;

      // Create context
      const ctx = this.createContext(plugin);

      // Activate
      if (instance.activate) {
        await instance.activate(ctx);
      }

      plugin.loaded = true;
      console.log(`🔌 Plugin ${manifest.name} v${manifest.version} loaded`);
      this.emit('plugin_loaded', plugin);
    } catch (err: any) {
      plugin.error = err.message;
      console.error(`⚠️ Plugin ${manifest.name}: activation failed — ${err.message}`);
    }
  }

  private createContext(plugin: LoadedPlugin): PluginContext {
    const pluginDb = createPluginDB(this.db, plugin.id);

    return {
      registerRoute: (method, path, handler) => {
        plugin.routes.push({ method, path, handler });
      },
      registerWebSocket: (event, handler) => {
        plugin.wsHandlers.set(event, handler);
      },
      getService: (name: string) => {
        return this.services.get(name);
      },
      log: (message: string) => {
        console.log(`[plugin:${plugin.id}] ${message}`);
      },
      getConfig: () => ({ ...plugin.config }),
      db: pluginDb,
      broadcast: (data: any) => {
        this.broadcastFn({ type: 'plugin_event', pluginId: plugin.id, ...data });
      },
    };
  }

  private loadConfig(pluginId: string, schema: Record<string, any>): Record<string, any> {
    // Load from DB first
    const row = this.db.prepare('SELECT config FROM plugin_config WHERE plugin_id = ?').get(pluginId) as any;
    if (row) {
      try { return JSON.parse(row.config); } catch { /* fall through */ }
    }

    // Build defaults from schema
    const defaults: Record<string, any> = {};
    for (const [key, def] of Object.entries(schema)) {
      if (def.default !== undefined) defaults[key] = def.default;
    }

    // Save defaults
    this.db.prepare(
      'INSERT OR REPLACE INTO plugin_config (plugin_id, config, enabled, updated_at) VALUES (?, ?, 1, ?)'
    ).run(pluginId, JSON.stringify(defaults), Date.now());

    return defaults;
  }

  /** Register all plugin routes on the Express app */
  registerRoutes(app: Express): void {
    for (const [, plugin] of this.plugins) {
      if (!plugin.enabled || !plugin.loaded) continue;
      for (const route of plugin.routes) {
        const fullPath = `/api/plugins/${plugin.id}${route.path}`;
        try {
          (app as any)[route.method](fullPath, (req: Request, res: Response) => {
            try {
              route.handler(req, res);
            } catch (err: any) {
              res.status(500).json({ error: `Plugin error: ${err.message}` });
            }
          });
        } catch { /* ignore duplicate route registration */ }
      }
    }
  }

  /** Handle WebSocket message from a plugin */
  handleWebSocketMessage(event: string, data: any, ws: WebSocket): boolean {
    for (const [, plugin] of this.plugins) {
      if (!plugin.enabled || !plugin.loaded) continue;
      const handler = plugin.wsHandlers.get(event);
      if (handler) {
        try {
          handler(data, ws);
          return true;
        } catch (err: any) {
          console.error(`[plugin:${plugin.id}] WS handler error: ${err.message}`);
        }
      }
    }
    return false;
  }

  // ── Public API ──

  getAll(): Array<{
    id: string; name: string; version: string; description: string;
    author: string; icon?: string; enabled: boolean; loaded: boolean;
    error?: string; provides: string[]; requires: string[];
  }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      icon: p.manifest.icon,
      enabled: p.enabled,
      loaded: p.loaded,
      error: p.error,
      provides: p.manifest.provides,
      requires: p.manifest.requires,
    }));
  }

  getPlugin(id: string) {
    const p = this.plugins.get(id);
    if (!p) return null;
    return {
      ...this.getAll().find(x => x.id === id),
      config: p.config,
      configSchema: p.manifest.config,
      routes: p.routes.map(r => ({ method: r.method, path: `/api/plugins/${id}${r.path}` })),
    };
  }

  updateConfig(id: string, config: Record<string, any>): boolean {
    const p = this.plugins.get(id);
    if (!p) return false;
    p.config = { ...p.config, ...config };
    this.db.prepare(
      'INSERT OR REPLACE INTO plugin_config (plugin_id, config, enabled, updated_at) VALUES (?, ?, ?, ?)'
    ).run(id, JSON.stringify(p.config), p.enabled ? 1 : 0, Date.now());
    this.emit('plugin_changed');
    return true;
  }

  async enablePlugin(id: string): Promise<boolean> {
    const p = this.plugins.get(id);
    if (!p) return false;
    p.enabled = true;
    this.db.prepare(
      'INSERT OR REPLACE INTO plugin_config (plugin_id, config, enabled, updated_at) VALUES (?, ?, 1, ?)'
    ).run(id, JSON.stringify(p.config), Date.now());

    // Try to activate if not loaded
    if (!p.loaded && p.instance?.activate) {
      try {
        await p.instance.activate(this.createContext(p));
        p.loaded = true;
        p.error = undefined;
      } catch (err: any) {
        p.error = err.message;
      }
    }

    this.emit('plugin_changed');
    return true;
  }

  async disablePlugin(id: string): Promise<boolean> {
    const p = this.plugins.get(id);
    if (!p) return false;
    p.enabled = false;
    this.db.prepare(
      'INSERT OR REPLACE INTO plugin_config (plugin_id, config, enabled, updated_at) VALUES (?, ?, 0, ?)'
    ).run(id, JSON.stringify(p.config), Date.now());

    // Deactivate
    if (p.loaded && p.instance?.deactivate) {
      try { await p.instance.deactivate(); } catch { /* ignore */ }
    }
    p.loaded = false;

    this.emit('plugin_changed');
    return true;
  }
}
