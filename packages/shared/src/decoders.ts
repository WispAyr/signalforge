// ============================================================================
// SignalForge Decoder Types
// ============================================================================

// --- ADS-B ---
export interface ADSBMessage {
  icao: string;         // 6-char hex ICAO address
  callsign?: string;
  altitude?: number;    // feet
  speed?: number;       // knots
  heading?: number;     // degrees
  latitude?: number;
  longitude?: number;
  verticalRate?: number;
  squawk?: string;
  onGround?: boolean;
  messageType: string;
  timestamp: number;
}

export interface Aircraft {
  icao: string;
  callsign?: string;
  altitude?: number;
  speed?: number;
  heading?: number;
  latitude?: number;
  longitude?: number;
  verticalRate?: number;
  squawk?: string;
  onGround?: boolean;
  lastSeen: number;
  messageCount: number;
  trail: Array<{ lat: number; lon: number; alt: number; ts: number }>;
}

// --- ACARS ---
export interface ACARSMessage {
  mode: string;
  label: string;
  blockId: string;
  ack: string;
  registration?: string;
  flightNumber?: string;
  messageText: string;
  frequency?: number;
  timestamp: number;
  signalLevel?: number;
}

// --- AIS ---
export interface AISMessage {
  mmsi: string;
  messageType: number;
  shipName?: string;
  callSign?: string;
  imo?: number;
  shipType?: number;
  shipTypeName?: string;
  latitude?: number;
  longitude?: number;
  cog?: number;         // course over ground
  sog?: number;         // speed over ground (knots)
  heading?: number;
  navStatus?: number;
  navStatusName?: string;
  destination?: string;
  eta?: string;
  draught?: number;
  dimensionA?: number;
  dimensionB?: number;
  dimensionC?: number;
  dimensionD?: number;
  timestamp: number;
}

export interface Vessel {
  mmsi: string;
  shipName?: string;
  callSign?: string;
  imo?: number;
  shipType?: number;
  shipTypeName?: string;
  latitude?: number;
  longitude?: number;
  cog?: number;
  sog?: number;
  heading?: number;
  navStatus?: number;
  navStatusName?: string;
  destination?: string;
  lastSeen: number;
  messageCount: number;
  trail: Array<{ lat: number; lon: number; ts: number }>;
}

// --- APRS ---
export interface APRSPacket {
  source: string;       // callsign
  destination: string;
  path: string[];
  dataType: string;     // position, message, weather, telemetry, etc.
  latitude?: number;
  longitude?: number;
  altitude?: number;    // meters
  speed?: number;       // km/h
  course?: number;
  symbol?: string;
  comment?: string;
  // Weather
  temperature?: number; // Celsius
  humidity?: number;
  pressure?: number;    // hPa
  windSpeed?: number;   // km/h
  windDirection?: number;
  rainfall?: number;    // mm
  // Message
  messageText?: string;
  messageAddressee?: string;
  timestamp: number;
}

export interface APRSStation {
  callsign: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  symbol?: string;
  comment?: string;
  lastSeen: number;
  packetCount: number;
  lastPacket?: APRSPacket;
}

// --- Dashboard ---
export interface DashboardStats {
  satellitesTracked: number;
  aircraftSeen: number;
  vesselsSeen: number;
  aprsStations: number;
  activeDecoders: number;
  acarsMessages: number;
  uptime: number;
  serverTime: string;
}

export interface ActivityFeedItem {
  id: string;
  type: 'satellite' | 'aircraft' | 'vessel' | 'aprs' | 'acars' | 'system';
  icon: string;
  title: string;
  detail: string;
  timestamp: number;
}

// --- Flowgraph Presets ---
export interface FlowPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  nodes: Array<{ type: string; position: { x: number; y: number }; params: Record<string, unknown> }>;
  connections: Array<{ sourceNode: number; sourcePort: string; targetNode: number; targetPort: string }>;
}
