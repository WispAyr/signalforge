import EventEmitter from 'events';
import type { NumberStation, NumberStationNowOnAir, NumberStationSchedule } from '@signalforge/shared';

export class NumberStationsService extends EventEmitter {
  private stations: NumberStation[] = [];
  private activeStations: NumberStationNowOnAir[] = [];

  constructor() {
    super();
    this.loadDatabase();
  }

  private loadDatabase() {
    // Load from The Conet Project / Priyom.org data
    this.stations = [
      {
        id: 'e11',
        designator: 'E11',
        nickname: 'Russian Man',
        country: 'Russia',
        operator: 'SVR (suspected)',
        language: 'Russian',
        signalType: 'USB',
        voiceType: 'male',
        description: 'Classic Russian numbers station with male voice, often transmitting on 4625 kHz.',
        firstLogged: '1992',
        status: 'active',
        frequencies: [
          { frequency: 4625000, mode: 'USB', primary: true },
          { frequency: 7345000, mode: 'USB', primary: false },
        ],
        schedule: [
          { timeUTC: '18:00', dayOfWeek: [1, 3, 5], duration: 30 },
        ],
        priyomRef: 'E11',
      },
      {
        id: 'm12',
        designator: 'M12',
        nickname: 'Chinese Female',
        country: 'China',
        operator: 'MSS',
        language: 'Chinese',
        signalType: 'AM',
        voiceType: 'female',
        description: 'Chinese numbers station with female voice, frequent on 7520 kHz.',
        firstLogged: '1998',
        status: 'active',
        frequencies: [
          { frequency: 7520000, mode: 'AM', primary: true },
        ],
        schedule: [
          { timeUTC: '02:00', dayOfWeek: [], duration: 45 },
        ],
        priyomRef: 'M12',
      },
      {
        id: 'v07',
        designator: 'V07',
        nickname: 'Lincolnshire Poacher',
        country: 'UK',
        operator: 'MI6',
        language: 'English',
        signalType: 'USB',
        voiceType: 'female',
        description: 'Famous station that transmitted from Cyprus with a signature melody.',
        firstLogged: '1970',
        status: 'inactive',
        frequencies: [
          { frequency: 6417500, mode: 'USB', primary: true },
          { frequency: 8379000, mode: 'USB', primary: false },
        ],
        schedule: [],
        priyomRef: 'V07',
      },
      {
        id: 's28',
        designator: 'S28',
        nickname: 'Swedish Rhapsody',
        country: 'Poland',
        operator: 'SB',
        language: 'Polish',
        signalType: 'USB',
        voiceType: 'female (child)',
        description: 'Notable for using a child\'s voice reading numbers.',
        firstLogged: '1988',
        status: 'inactive',
        frequencies: [
          { frequency: 4755000, mode: 'USB', primary: true },
        ],
        schedule: [],
        priyomRef: 'S28',
      },
      {
        id: 'x06',
        designator: 'X06',
        nickname: 'Cuban Spanish Lady',
        country: 'Cuba',
        operator: 'DGI',
        language: 'Spanish',
        signalType: 'USB',
        voiceType: 'female',
        description: 'Cuban station with female voice and distinctive musical introduction.',
        firstLogged: '1994',
        status: 'active',
        frequencies: [
          { frequency: 6477000, mode: 'USB', primary: true },
          { frequency: 8537500, mode: 'USB', primary: false },
        ],
        schedule: [
          { timeUTC: '23:00', dayOfWeek: [], duration: 30 },
        ],
        priyomRef: 'X06',
      },
      {
        id: 'g03',
        designator: 'G03',
        nickname: 'German Counting',
        country: 'Germany',
        language: 'German',
        signalType: 'CW',
        voiceType: null,
        description: 'Morse code station transmitting groups of 5 numbers.',
        firstLogged: '1990',
        status: 'active',
        frequencies: [
          { frequency: 4332000, mode: 'CW', primary: true },
        ],
        schedule: [
          { timeUTC: '12:30', dayOfWeek: [2, 4, 6], duration: 20 },
        ],
      },
    ];

    this.updateNowOnAir();
    setInterval(() => this.updateNowOnAir(), 60000); // Update every minute
  }

  private updateNowOnAir() {
    const now = new Date();
    const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const currentTime = hour * 60 + minute;

    this.activeStations = this.stations
      .filter(s => s.status === 'active')
      .flatMap(s => s.schedule.map(sched => {
        const [h, m] = sched.timeUTC.split(':').map(Number);
        const start = h * 60 + m;
        const end = start + (sched.duration || 30);

        const daysMatch = !sched.dayOfWeek || sched.dayOfWeek.length === 0 || sched.dayOfWeek.includes(day === 0 ? 7 : day);
        const timeMatch = currentTime >= start && currentTime <= end;

        if (daysMatch && timeMatch) {
          return {
            station: s,
            frequency: s.frequencies.find(f => f.primary)?.frequency || s.frequencies[0].frequency,
            startTime: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
            endTime: `${Math.floor(end / 60).toString().padStart(2, '0')}:${(end % 60).toString().padStart(2, '0')}`,
            webSdrUrl: `http://websdr.org/?freq=${(s.frequencies[0].frequency / 1000).toFixed(0)}`,
          };
        }
        return null;
      }))
      .filter((x): x is NonNullable<typeof x> => x !== null) as NumberStationNowOnAir[];

    this.emit('now_on_air', this.activeStations);
  }

  getStations(): NumberStation[] {
    return this.stations;
  }

  getStation(id: string): NumberStation | undefined {
    return this.stations.find(s => s.id === id);
  }

  getNowOnAir(): NumberStationNowOnAir[] {
    return this.activeStations;
  }

  getActiveStations(): NumberStation[] {
    return this.stations.filter(s => s.status === 'active');
  }

  searchStations(query: string): NumberStation[] {
    const q = query.toLowerCase();
    return this.stations.filter(s =>
      s.designator.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (s.country && s.country.toLowerCase().includes(q)) ||
      (s.language && s.language.toLowerCase().includes(q))
    );
  }
}