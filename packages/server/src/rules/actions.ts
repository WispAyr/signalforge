// ============================================================================
// Action Executors — fire side effects when rules trigger
// ============================================================================

import type { RuleAction, RuleEvent } from '@signalforge/shared';

export type BroadcastFn = (data: unknown) => void;
export type MqttPublishFn = (topic: string, payload: string) => void;

export interface ActionContext {
  broadcast: BroadcastFn;
  mqttPublish?: MqttPublishFn;
  entityId: string;
  source: string;
  ruleName: string;
  data: Record<string, unknown>;
}

/** Interpolate {{var}} templates against data + context */
function interpolate(template: string, ctx: ActionContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === 'entity') return ctx.entityId;
    if (key === 'source') return ctx.source;
    if (key === 'ruleName') return ctx.ruleName;
    if (key === 'json') return JSON.stringify(ctx.data).slice(0, 2000);
    if (key === 'callsign') return String(ctx.data.callsign || ctx.data.source || ctx.entityId);
    if (key === 'timestamp') return new Date().toISOString();
    const v = ctx.data[key];
    return v !== undefined ? String(v) : `{{${key}}}`;
  });
}

export async function executeAction(action: RuleAction, ctx: ActionContext): Promise<string> {
  switch (action.type) {
    case 'webhook': {
      try {
        const body = JSON.stringify({
          entity: ctx.entityId,
          source: ctx.source,
          rule: ctx.ruleName,
          data: ctx.data,
          timestamp: Date.now(),
        });
        await fetch(action.url, {
          method: action.method || 'POST',
          headers: { 'Content-Type': 'application/json', ...action.headers },
          body,
          signal: AbortSignal.timeout(10000),
        });
        return `webhook:${action.url}`;
      } catch (e) {
        console.error('[rules] webhook error:', (e as Error).message);
        return `webhook:FAILED:${action.url}`;
      }
    }
    case 'mqtt': {
      if (ctx.mqttPublish) {
        const payload = action.payload ? interpolate(action.payload, ctx) : JSON.stringify(ctx.data);
        ctx.mqttPublish(action.topic, payload);
      }
      return `mqtt:${action.topic}`;
    }
    case 'telegram': {
      const message = interpolate(action.message, ctx);
      // Broadcast to client — client-side can forward via bot API or display
      ctx.broadcast({
        type: 'rule_telegram',
        chatId: action.chatId,
        message,
        entity: ctx.entityId,
        timestamp: Date.now(),
      });
      return `telegram:${action.chatId}`;
    }
    case 'log': {
      const prefix = action.level === 'alert' ? '🚨' : action.level === 'warn' ? '⚠️' : 'ℹ️';
      console.log(`[rules] ${prefix} ${ctx.ruleName}: ${ctx.entityId} (${ctx.source})`);
      ctx.broadcast({
        type: 'rule_log',
        level: action.level,
        ruleName: ctx.ruleName,
        entity: ctx.entityId,
        source: ctx.source,
        timestamp: Date.now(),
      });
      return `log:${action.level}`;
    }
    case 'sound': {
      ctx.broadcast({
        type: 'rule_sound',
        sound: action.sound,
        ruleName: ctx.ruleName,
        entity: ctx.entityId,
        timestamp: Date.now(),
      });
      return `sound:${action.sound}`;
    }
    case 'highlight_map': {
      ctx.broadcast({
        type: 'rule_highlight',
        entity: ctx.entityId,
        source: ctx.source,
        duration: action.duration,
        timestamp: Date.now(),
      });
      return `highlight:${action.duration}ms`;
    }
    case 'tts': {
      const message = interpolate(action.message, ctx);
      ctx.broadcast({
        type: 'rule_tts',
        message,
        entity: ctx.entityId,
        timestamp: Date.now(),
      });
      return `tts:${message.slice(0, 40)}`;
    }
    case 'record_signal': {
      ctx.broadcast({
        type: 'rule_record',
        durationMs: action.durationMs,
        entity: ctx.entityId,
        source: ctx.source,
        timestamp: Date.now(),
      });
      return `record:${action.durationMs}ms`;
    }
    case 'tag_entity': {
      ctx.broadcast({
        type: 'rule_tag',
        entity: ctx.entityId,
        source: ctx.source,
        tags: action.tags,
        timestamp: Date.now(),
      });
      return `tag:${action.tags.join(',')}`;
    }
    case 'chain_rule': {
      // Handled by engine — just return the intent
      return `chain:${action.ruleId}`;
    }
    default:
      return 'unknown';
  }
}
