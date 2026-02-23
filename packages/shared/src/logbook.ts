// Station Logbook Types (ADIF Compatible)

export interface LogEntry {
  id: string;
  callsign: string;
  frequency: number; // Hz
  band: string; // e.g. '20m', '2m'
  mode: string; // e.g. 'SSB', 'CW', 'FT8', 'FM'
  rstSent: string;
  rstReceived: string;
  dateTimeOn: number; // start timestamp
  dateTimeOff?: number; // end timestamp
  name?: string;
  qth?: string;
  gridSquare?: string;
  power?: number; // watts
  notes?: string;
  qslSent: 'Y' | 'N' | 'R' | 'Q'; // Yes, No, Requested, Queued
  qslReceived: 'Y' | 'N' | 'R';
  qslVia?: string;
  eqsl?: boolean;
  lotw?: boolean;
  operator?: string;
  myCallsign?: string;
  myGrid?: string;
  contestId?: string;
  serialSent?: number;
  serialReceived?: number;
  // Links to other SignalForge data
  recordingId?: string;
  waterfallId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LogbookStats {
  totalContacts: number;
  uniqueCallsigns: number;
  uniqueCountries: number;
  bandBreakdown: Record<string, number>;
  modeBreakdown: Record<string, number>;
  recentContacts: LogEntry[];
}

export interface ADIFField {
  name: string;
  length: number;
  type?: string;
  value: string;
}
