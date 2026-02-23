// Number Stations / Spy Stations Database Types

export interface NumberStation {
  id: string;
  designator: string;
  nickname?: string;
  country?: string;
  operator?: string;
  language?: string;
  frequencies: NumberStationFrequency[];
  schedule: NumberStationSchedule[];
  signalType: string;
  voiceType?: string | null;
  status: 'active' | 'inactive' | 'unknown';
  firstLogged?: string;
  lastLogged?: string;
  description: string;
  notes?: string;
  conetProjectRef?: string;
  priyomRef?: string;
  recordings?: NumberStationRecording[];
}

export interface NumberStationFrequency {
  frequency: number;
  mode: string;
  bandwidth?: number;
  primary: boolean;
  lastHeard?: number;
}

export interface NumberStationSchedule {
  dayOfWeek?: number[];
  timeUTC: string;
  duration?: number;
  frequency?: number;
  notes?: string;
}

export interface NumberStationRecording {
  id: string;
  stationId: string;
  timestamp: number;
  frequency: number;
  duration: number;
  url?: string;
  notes?: string;
}

export interface NumberStationNowOnAir {
  station: NumberStation;
  frequency: number;
  startTime: string;
  endTime: string;
  webSdrUrl?: string;
}
