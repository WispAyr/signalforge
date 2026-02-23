// ============================================================================
// Rules Engine — core evaluation loop
// ============================================================================

import { EventEmitter } from 'events';
import { db } from '../services/database.js';
import { evaluateCondition, touchEntity, type GeofenceChecker, type ConditionContext } from './conditions.js';
import { executeAction, type BroadcastFn, type MqttPublishFn } from './actions.js';
import type { Rule, RuleEvent, RuleCondition, RuleAction } from '@signalforge/shared';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class RulesEngine extends EventEmitter {
  private rules = new Map<string, Rule>();
  private broadcast: BroadcastFn;
  private mqttPublish?: MqttPublishFn;
  private geofenceChecker?: GeofenceChecker;
  private lostCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(broadcast: BroadcastFn, mqttPublish?: MqttPublishFn, geofenceChecker?: GeofenceChecker) {
    super();
    this.broadcast = broadcast;
    this.mqttPublish = mqttPublish;
    this.geofenceChecker = geofenceChecker;
    this.initDb();
    this.loadRules();
    this.seedDefaults();

    // Periodically check for lost entities
    this.lostCheckInterval = setInterval(() => this.checkLostEntities(), 30000);
  }

  private initDb(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER DEFAULT 1,
        source TEXT NOT NULL,
        conditions TEXT NOT NULL,
        condition_logic TEXT DEFAULT 'AND',
        actions TEXT NOT NULL,
        cooldown_ms INTEGER DEFAULT 60000,
        last_triggered INTEGER,
        trigger_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rule_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        entity TEXT NOT NULL,
        matched_conditions TEXT NOT NULL,
        actions_executed TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rule_events_time ON rule_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_rule_events_rule ON rule_events(rule_id);
    `);
  }

  private loadRules(): void {
    const rows = db.prepare('SELECT * FROM rules').all() as any[];
    this.rules.clear();
    for (const r of rows) {
      this.rules.set(r.id, {
        id: r.id,
        name: r.name,
        description: r.description,
        enabled: !!r.enabled,
        source: JSON.parse(r.source),
        conditions: JSON.parse(r.conditions),
        conditionLogic: r.condition_logic || 'AND',
        actions: JSON.parse(r.actions),
        cooldownMs: r.cooldown_ms,
        lastTriggered: r.last_triggered || undefined,
        triggerCount: r.trigger_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
  }

  private seedDefaults(): void {
    if (this.rules.size > 0) return;
    const templates: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        name: 'Emergency Alert',
        description: 'Detect APRS emergencies, ADS-B squawk 7x00, AIS distress',
        enabled: false,
        source: { type: 'any' },
        conditions: [{ type: 'emergency' }],
        conditionLogic: 'AND',
        actions: [
          { type: 'sound', sound: 'alarm' },
          { type: 'log', level: 'alert' },
          { type: 'highlight_map', duration: 30000 },
        ],
        cooldownMs: 60000,
        triggerCount: 0,
      },
      {
        name: 'New Aircraft',
        description: 'Alert when a new ADS-B aircraft appears',
        enabled: false,
        source: { type: 'adsb' },
        conditions: [{ type: 'new_entity' }],
        conditionLogic: 'AND',
        actions: [{ type: 'log', level: 'info' }],
        cooldownMs: 0,
        triggerCount: 0,
      },
      {
        name: 'High Wind Alert',
        description: 'APRS weather stations reporting wind > 50 kts',
        enabled: false,
        source: { type: 'aprs' },
        conditions: [{ type: 'wind_above', threshold: 50 }],
        conditionLogic: 'AND',
        actions: [{ type: 'log', level: 'warn' }],
        cooldownMs: 300000,
        triggerCount: 0,
      },
      {
        name: 'Station Tracker',
        description: 'Track GM8* callsigns on APRS',
        enabled: false,
        source: { type: 'aprs' },
        conditions: [{ type: 'callsign_match', pattern: 'GM8.*' }],
        conditionLogic: 'AND',
        actions: [{ type: 'highlight_map', duration: 15000 }],
        cooldownMs: 60000,
        triggerCount: 0,
      },
    ];
    for (const t of templates) {
      this.createRule(t);
    }
  }

  // === CRUD ===

  createRule(data: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>): Rule {
    const now = Date.now();
    const rule: Rule = {
      ...data,
      id: `rule-${uid()}`,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(`INSERT INTO rules (id, name, description, enabled, source, conditions, condition_logic, actions, cooldown_ms, last_triggered, trigger_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(rule.id, rule.name, rule.description || null, rule.enabled ? 1 : 0,
        JSON.stringify(rule.source), JSON.stringify(rule.conditions), rule.conditionLogic,
        JSON.stringify(rule.actions), rule.cooldownMs, rule.lastTriggered || null,
        rule.triggerCount, rule.createdAt, rule.updatedAt);
    this.rules.set(rule.id, rule);
    return rule;
  }

  updateRule(id: string, updates: Partial<Rule>): Rule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, id, updatedAt: Date.now() };
    db.prepare(`UPDATE rules SET name=?, description=?, enabled=?, source=?, conditions=?, condition_logic=?, actions=?, cooldown_ms=?, updated_at=? WHERE id=?`)
      .run(merged.name, merged.description || null, merged.enabled ? 1 : 0,
        JSON.stringify(merged.source), JSON.stringify(merged.conditions), merged.conditionLogic,
        JSON.stringify(merged.actions), merged.cooldownMs, merged.updatedAt, id);
    this.rules.set(id, merged);
    return merged;
  }

  deleteRule(id: string): boolean {
    const ok = this.rules.delete(id);
    if (ok) db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    return ok;
  }

  getRule(id: string): Rule | undefined {
    return this.rules.get(id);
  }

  getRules(): Rule[] {
    return [...this.rules.values()];
  }

  enableRule(id: string): Rule | null { return this.updateRule(id, { enabled: true }); }
  disableRule(id: string): Rule | null { return this.updateRule(id, { enabled: false }); }

  // === Evaluation ===

  async evaluate(sourceType: string, entityId: string, data: Record<string, unknown>): Promise<void> {
    touchEntity(sourceType, entityId);

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Source filter
      if (rule.source.type !== 'any' && rule.source.type !== sourceType) continue;

      // Cooldown check
      if (rule.cooldownMs > 0 && rule.lastTriggered) {
        if (Date.now() - rule.lastTriggered < rule.cooldownMs) continue;
      }

      // Evaluate conditions
      const ctx: ConditionContext = {
        entityId,
        source: sourceType,
        geofenceChecker: this.geofenceChecker,
      };

      const results = rule.conditions.map(c => ({
        condition: c,
        matched: evaluateCondition(c, data, ctx),
      }));

      const allMatched = rule.conditionLogic === 'AND'
        ? results.every(r => r.matched)
        : results.some(r => r.matched);

      if (!allMatched || results.length === 0) continue;

      // Fire!
      const matchedConditions = results.filter(r => r.matched).map(r => r.condition.type);
      const actionsExecuted: string[] = [];

      const actionCtx = {
        broadcast: this.broadcast,
        mqttPublish: this.mqttPublish,
        entityId,
        source: sourceType,
        ruleName: rule.name,
        data,
      };

      for (const action of rule.actions) {
        const result = await executeAction(action, actionCtx);
        actionsExecuted.push(result);

        // Handle chain_rule
        if (action.type === 'chain_rule') {
          const chainedRule = this.rules.get(action.ruleId);
          if (chainedRule && chainedRule.enabled) {
            // Re-evaluate with same data (non-recursive — max 1 level)
            const chainCtx: ConditionContext = { entityId, source: sourceType, geofenceChecker: this.geofenceChecker };
            const chainResults = chainedRule.conditions.map(c => evaluateCondition(c, data, chainCtx));
            const chainMatched = chainedRule.conditionLogic === 'AND' ? chainResults.every(Boolean) : chainResults.some(Boolean);
            if (chainMatched) {
              for (const a of chainedRule.actions) {
                if (a.type !== 'chain_rule') { // prevent infinite loops
                  await executeAction(a, { ...actionCtx, ruleName: chainedRule.name });
                }
              }
            }
          }
        }
      }

      // Update rule stats
      rule.lastTriggered = Date.now();
      rule.triggerCount++;
      db.prepare('UPDATE rules SET last_triggered=?, trigger_count=? WHERE id=?')
        .run(rule.lastTriggered, rule.triggerCount, rule.id);

      // Log event
      const event: RuleEvent = {
        id: `evt-${uid()}`,
        ruleId: rule.id,
        ruleName: rule.name,
        timestamp: Date.now(),
        source: sourceType,
        entity: entityId,
        matchedConditions,
        actionsExecuted,
        data,
      };

      db.prepare(`INSERT INTO rule_events (id, rule_id, rule_name, timestamp, source, entity, matched_conditions, actions_executed, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(event.id, event.ruleId, event.ruleName, event.timestamp, event.source,
          event.entity, JSON.stringify(event.matchedConditions), JSON.stringify(event.actionsExecuted),
          JSON.stringify(event.data));

      // Broadcast to clients
      this.broadcast({
        type: 'rule_triggered',
        ruleId: rule.id,
        ruleName: rule.name,
        entity: entityId,
        source: sourceType,
        timestamp: event.timestamp,
        conditions: matchedConditions,
        actions: actionsExecuted,
      });

      this.emit('triggered', event);
    }
  }

  // === Entity Lost Check ===

  private checkLostEntities(): void {
    // Find rules with entity_lost conditions
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      for (const cond of rule.conditions) {
        if (cond.type === 'entity_lost') {
          // This is handled passively via the evaluate() call — entity_lost
          // checks time since last seen. The periodic tick here is just a nudge.
          // We don't re-trigger on tick to avoid noise.
        }
      }
    }
  }

  // === Events Query ===

  getEvents(opts: { ruleId?: string; limit?: number; offset?: number } = {}): RuleEvent[] {
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;
    let rows: any[];
    if (opts.ruleId) {
      rows = db.prepare('SELECT * FROM rule_events WHERE rule_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?')
        .all(opts.ruleId, limit, offset) as any[];
    } else {
      rows = db.prepare('SELECT * FROM rule_events ORDER BY timestamp DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as any[];
    }
    return rows.map(r => ({
      id: r.id,
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      timestamp: r.timestamp,
      source: r.source,
      entity: r.entity,
      matchedConditions: JSON.parse(r.matched_conditions),
      actionsExecuted: JSON.parse(r.actions_executed),
      data: JSON.parse(r.data),
    }));
  }

  getStats(): { total: number; active: number; disabled: number; triggersLastHour: number; triggers24h: number; mostActive: string | null } {
    const rules = this.getRules();
    const now = Date.now();
    const hour = now - 3600000;
    const day = now - 86400000;

    const triggersLastHour = (db.prepare('SELECT COUNT(*) as c FROM rule_events WHERE timestamp > ?').get(hour) as any)?.c || 0;
    const triggers24h = (db.prepare('SELECT COUNT(*) as c FROM rule_events WHERE timestamp > ?').get(day) as any)?.c || 0;

    const mostActiveRow = db.prepare('SELECT rule_name, COUNT(*) as c FROM rule_events WHERE timestamp > ? GROUP BY rule_id ORDER BY c DESC LIMIT 1').get(day) as any;

    return {
      total: rules.length,
      active: rules.filter(r => r.enabled).length,
      disabled: rules.filter(r => !r.enabled).length,
      triggersLastHour,
      triggers24h,
      mostActive: mostActiveRow?.rule_name || null,
    };
  }

  // Test a rule against sample data without persisting
  async testRule(ruleId: string, sampleData?: Record<string, unknown>): Promise<{ matched: boolean; conditions: { type: string; matched: boolean }[] }> {
    const rule = this.rules.get(ruleId);
    if (!rule) return { matched: false, conditions: [] };

    const data = sampleData || { callsign: 'TEST123', speed: 250, altitude: 35000, squawk: '7700', latitude: 51.5, longitude: -0.1 };
    const ctx: ConditionContext = { entityId: 'TEST', source: rule.source.type, geofenceChecker: this.geofenceChecker };

    const conditions = rule.conditions.map(c => ({
      type: c.type,
      matched: evaluateCondition(c, data, ctx),
    }));

    const matched = rule.conditionLogic === 'AND'
      ? conditions.every(c => c.matched)
      : conditions.some(c => c.matched);

    return { matched, conditions };
  }

  stop(): void {
    if (this.lostCheckInterval) clearInterval(this.lostCheckInterval);
  }
}
