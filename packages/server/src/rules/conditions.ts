// ============================================================================
// Condition Evaluators — each returns true/false against entity data
// ============================================================================

import type { RuleCondition } from '@signalforge/shared';

type EntityData = Record<string, unknown>;

// Cache for rate-of-change sliding windows: entityId -> field -> [{ value, time }]
const rocWindows = new Map<string, Map<string, { value: number; time: number }[]>>();
const ROC_WINDOW_SIZE = 20;

// Cache for seen entities (for new_entity condition)
const seenEntities = new Set<string>();

// Cache for last-seen times (for entity_lost condition)
const lastSeen = new Map<string, number>();

function getField(data: EntityData, field: string): unknown {
  // Support dotted paths: "weather.temp"
  const parts = field.split('.');
  let v: unknown = data;
  for (const p of parts) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[p];
  }
  return v;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

// Geofence check requires external service — we accept a checker function
export type GeofenceChecker = (zoneId: string, entityId: string) => 'inside' | 'outside' | 'unknown';

export interface ConditionContext {
  entityId: string;
  source: string;
  geofenceChecker?: GeofenceChecker;
}

export function evaluateCondition(
  condition: RuleCondition,
  data: EntityData,
  ctx: ConditionContext
): boolean {
  switch (condition.type) {
    case 'geofence_enter': {
      if (!ctx.geofenceChecker) return false;
      return ctx.geofenceChecker(condition.zoneId, ctx.entityId) === 'inside';
    }
    case 'geofence_exit': {
      if (!ctx.geofenceChecker) return false;
      return ctx.geofenceChecker(condition.zoneId, ctx.entityId) === 'outside';
    }
    case 'callsign_match': {
      const callsign = String(data.callsign || data.source || data.shipName || ctx.entityId || '');
      try {
        return new RegExp(condition.pattern, 'i').test(callsign);
      } catch { return false; }
    }
    case 'squawk_match': {
      const squawk = String(data.squawk || '');
      return condition.codes.includes(squawk);
    }
    case 'speed_above': {
      const v = toNumber(data.speed ?? data.sog ?? data.groundSpeed);
      return v !== null && v > condition.threshold;
    }
    case 'speed_below': {
      const v = toNumber(data.speed ?? data.sog ?? data.groundSpeed);
      return v !== null && v < condition.threshold;
    }
    case 'altitude_above': {
      const v = toNumber(data.altitude ?? data.alt);
      return v !== null && v > condition.threshold;
    }
    case 'altitude_below': {
      const v = toNumber(data.altitude ?? data.alt);
      return v !== null && v < condition.threshold;
    }
    case 'temp_above': {
      const v = toNumber(data.temperature ?? data.temp);
      return v !== null && v > condition.threshold;
    }
    case 'temp_below': {
      const v = toNumber(data.temperature ?? data.temp);
      return v !== null && v < condition.threshold;
    }
    case 'pressure_below': {
      const v = toNumber(data.pressure ?? data.barometric);
      return v !== null && v < condition.threshold;
    }
    case 'wind_above': {
      const v = toNumber(data.windSpeed ?? data.wind);
      return v !== null && v > condition.threshold;
    }
    case 'new_entity': {
      const key = `${ctx.source}:${ctx.entityId}`;
      if (seenEntities.has(key)) return false;
      seenEntities.add(key);
      return true;
    }
    case 'entity_lost': {
      const key = `${ctx.source}:${ctx.entityId}`;
      const now = Date.now();
      const prev = lastSeen.get(key);
      lastSeen.set(key, now);
      if (!prev) return false;
      return (now - prev) > condition.timeoutMs;
    }
    case 'rate_of_change': {
      const val = toNumber(getField(data, condition.field));
      if (val === null) return false;
      const key = `${ctx.source}:${ctx.entityId}`;
      if (!rocWindows.has(key)) rocWindows.set(key, new Map());
      const entityWindows = rocWindows.get(key)!;
      if (!entityWindows.has(condition.field)) entityWindows.set(condition.field, []);
      const window = entityWindows.get(condition.field)!;
      const now = Date.now();
      window.push({ value: val, time: now });
      if (window.length > ROC_WINDOW_SIZE) window.shift();
      if (window.length < 2) return false;
      const first = window[0];
      const last = window[window.length - 1];
      const dt = (last.time - first.time) / 1000; // seconds
      if (dt <= 0) return false;
      const rate = (last.value - first.value) / dt;
      if (condition.direction === 'rising') return rate > condition.threshold;
      return rate < -condition.threshold;
    }
    case 'keyword_match': {
      const val = String(getField(data, condition.field) ?? '');
      try {
        return new RegExp(condition.pattern, 'i').test(val);
      } catch { return false; }
    }
    case 'emergency': {
      // APRS emergency flag
      if (data.dataType === 'emergency' || data.emergency === true) return true;
      // ADS-B squawk emergency codes
      const sq = String(data.squawk || '');
      if (['7500', '7600', '7700'].includes(sq)) return true;
      // AIS distress
      if (data.navStatus === 14 || data.aisDistress === true) return true;
      return false;
    }
    case 'custom_js': {
      try {
        // Sandboxed-ish evaluation — exposes only `data` and `entity`
        const fn = new Function('data', 'entity', 'source', `return !!(${condition.expression})`);
        return fn(data, ctx.entityId, ctx.source);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Update last-seen tracking (call for every incoming entity) */
export function touchEntity(source: string, entityId: string): void {
  lastSeen.set(`${source}:${entityId}`, Date.now());
}

/** Get entity IDs that haven't been seen within timeoutMs */
export function getLostEntities(timeoutMs: number): { source: string; entityId: string }[] {
  const now = Date.now();
  const lost: { source: string; entityId: string }[] = [];
  for (const [key, time] of lastSeen) {
    if (now - time > timeoutMs) {
      const [source, entityId] = key.split(':', 2);
      lost.push({ source, entityId });
    }
  }
  return lost;
}
