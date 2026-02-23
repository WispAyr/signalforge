// Geo-Fencing & Alerts Types

export type ZoneType = 'circle' | 'polygon' | 'corridor';

export interface GeoZone {
  id: string;
  name: string;
  type: ZoneType;
  enabled: boolean;
  color: string;
  opacity: number;
  // Circle
  center?: { lat: number; lng: number };
  radius?: number; // meters
  // Polygon
  points?: { lat: number; lng: number }[];
  // Corridor
  path?: { lat: number; lng: number }[];
  width?: number; // meters
  // Alert config
  alertOnEnter: boolean;
  alertOnExit: boolean;
  trackedTypes: ('aircraft' | 'vessel' | 'satellite' | 'aprs')[];
  createdAt: number;
}

export interface GeoAlert {
  id: string;
  zoneId: string;
  zoneName: string;
  entityType: 'aircraft' | 'vessel' | 'satellite' | 'aprs';
  entityId: string;
  entityName: string;
  event: 'enter' | 'exit';
  timestamp: number;
  position: { lat: number; lng: number; alt?: number };
  acknowledged: boolean;
}
