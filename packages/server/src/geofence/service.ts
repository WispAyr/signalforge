import { EventEmitter } from 'events';
import type { GeoZone, GeoAlert } from '@signalforge/shared';

export class GeofenceService extends EventEmitter {
  private zones = new Map<string, GeoZone>();
  private alerts: GeoAlert[] = [];
  private entityPositions = new Map<string, { lat: number; lng: number; inside: Set<string> }>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
  }

  start() {
    // Check entities against zones every 5 seconds
    this.checkInterval = setInterval(() => this.checkAllEntities(), 5000);
  }

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }

  addZone(zone: Omit<GeoZone, 'id' | 'createdAt'>): GeoZone {
    const z: GeoZone = {
      ...zone,
      id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    this.zones.set(z.id, z);
    this.emit('zone_added', z);
    return z;
  }

  updateZone(id: string, updates: Partial<GeoZone>): GeoZone | null {
    const zone = this.zones.get(id);
    if (!zone) return null;
    Object.assign(zone, updates);
    this.emit('zone_updated', zone);
    return zone;
  }

  removeZone(id: string): boolean {
    const ok = this.zones.delete(id);
    if (ok) this.emit('zone_removed', id);
    return ok;
  }

  getZones(): GeoZone[] {
    return [...this.zones.values()];
  }

  getAlerts(limit = 100): GeoAlert[] {
    return this.alerts.slice(0, limit);
  }

  acknowledgeAlert(id: string): boolean {
    const alert = this.alerts.find(a => a.id === id);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  updateEntityPosition(entityType: GeoAlert['entityType'], entityId: string, entityName: string, lat: number, lng: number, alt?: number) {
    const key = `${entityType}:${entityId}`;
    if (!this.entityPositions.has(key)) {
      this.entityPositions.set(key, { lat, lng, inside: new Set() });
    }
    const entity = this.entityPositions.get(key)!;
    entity.lat = lat;
    entity.lng = lng;

    // Check against all zones
    for (const zone of this.zones.values()) {
      if (!zone.enabled) continue;
      if (!zone.trackedTypes.includes(entityType)) continue;

      const inside = this.isInsideZone(lat, lng, zone);
      const wasInside = entity.inside.has(zone.id);

      if (inside && !wasInside) {
        entity.inside.add(zone.id);
        if (zone.alertOnEnter) {
          this.createAlert(zone, entityType, entityId, entityName, 'enter', lat, lng, alt);
        }
      } else if (!inside && wasInside) {
        entity.inside.delete(zone.id);
        if (zone.alertOnExit) {
          this.createAlert(zone, entityType, entityId, entityName, 'exit', lat, lng, alt);
        }
      }
    }
  }

  private createAlert(zone: GeoZone, entityType: GeoAlert['entityType'], entityId: string, entityName: string, event: 'enter' | 'exit', lat: number, lng: number, alt?: number) {
    const alert: GeoAlert = {
      id: `ga-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      zoneId: zone.id,
      zoneName: zone.name,
      entityType,
      entityId,
      entityName,
      event,
      timestamp: Date.now(),
      position: { lat, lng, alt },
      acknowledged: false,
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > 1000) this.alerts.length = 1000;
    this.emit('geo_alert', alert);
  }

  private isInsideZone(lat: number, lng: number, zone: GeoZone): boolean {
    if (zone.type === 'circle' && zone.center && zone.radius) {
      const d = this.haversine(lat, lng, zone.center.lat, zone.center.lng);
      return d <= zone.radius;
    }
    if (zone.type === 'polygon' && zone.points && zone.points.length >= 3) {
      return this.pointInPolygon(lat, lng, zone.points);
    }
    if (zone.type === 'corridor' && zone.path && zone.path.length >= 2 && zone.width) {
      return this.pointInCorridor(lat, lng, zone.path, zone.width);
    }
    return false;
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private pointInPolygon(lat: number, lng: number, polygon: { lat: number; lng: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lat, yi = polygon[i].lng;
      const xj = polygon[j].lat, yj = polygon[j].lng;
      if ((yi > lng) !== (yj > lng) && lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  private pointInCorridor(lat: number, lng: number, path: { lat: number; lng: number }[], width: number): boolean {
    for (let i = 0; i < path.length - 1; i++) {
      const d = this.distToSegment(lat, lng, path[i], path[i + 1]);
      if (d <= width / 2) return true;
    }
    return false;
  }

  private distToSegment(lat: number, lng: number, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    // Simplified: closest point on segment then haversine
    const dx = b.lat - a.lat, dy = b.lng - a.lng;
    const t = Math.max(0, Math.min(1, ((lat - a.lat) * dx + (lng - a.lng) * dy) / (dx * dx + dy * dy)));
    return this.haversine(lat, lng, a.lat + t * dx, a.lng + t * dy);
  }

  private checkAllEntities() {
    // Passive — positions updated via updateEntityPosition calls
  }
}
