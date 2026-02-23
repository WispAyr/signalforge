import EventEmitter from 'events';
import type { CommunityFlowgraph, CommunityPlugin, CommunityComment, UserProfile, FlowgraphCategory } from '@signalforge/shared';

export class CommunityService extends EventEmitter {
  private flowgraphs: CommunityFlowgraph[] = [];
  private plugins: CommunityPlugin[] = [];
  private profiles: Map<string, UserProfile> = new Map();

  constructor() {
    super();
    this.loadDefaults();
  }

  private loadDefaults() {
    this.flowgraphs = [
      { id: 'fg-1', name: 'ADS-B Aircraft Tracker', description: 'Complete ADS-B reception and decoding pipeline with map overlay. Tunes to 1090 MHz, decodes Mode-S and ADS-B.', author: 'SignalForge', authorCallsign: 'M0SFG', category: 'aviation', tags: ['adsb', '1090mhz', 'aircraft', 'rtlsdr'], flowData: {}, rating: 4.8, ratingCount: 142, downloads: 2847, comments: [], createdAt: Date.now() - 86400000 * 30, updatedAt: Date.now() - 86400000 * 5 },
      { id: 'fg-2', name: 'NOAA APT Weather Satellite', description: 'Receive NOAA 15/18/19 APT images. Auto-tracks satellite and applies Doppler correction.', author: 'WxSat_UK', authorCallsign: 'G4WXS', category: 'satellite', tags: ['noaa', 'apt', 'weather', 'satellite'], flowData: {}, rating: 4.6, ratingCount: 89, downloads: 1563, comments: [], createdAt: Date.now() - 86400000 * 45, updatedAt: Date.now() - 86400000 * 10 },
      { id: 'fg-3', name: 'Marine AIS Dual-Channel', description: 'Dual-channel AIS reception on 161.975 and 162.025 MHz. Shows vessel positions on map.', author: 'CoastalOps', authorCallsign: 'MM0AIS', category: 'marine', tags: ['ais', 'marine', 'vessels', 'vhf'], flowData: {}, rating: 4.5, ratingCount: 67, downloads: 984, comments: [], createdAt: Date.now() - 86400000 * 20, updatedAt: Date.now() - 86400000 * 3 },
      { id: 'fg-4', name: 'ISM 433 MHz IoT Scanner', description: 'Scan the 433 MHz ISM band for wireless sensors, weather stations, and IoT devices using rtl_433.', author: 'IoTHunter', category: 'iot', tags: ['ism', '433mhz', 'iot', 'rtl433', 'sensors'], flowData: {}, rating: 4.3, ratingCount: 53, downloads: 721, comments: [], createdAt: Date.now() - 86400000 * 15, updatedAt: Date.now() - 86400000 * 2 },
      { id: 'fg-5', name: 'HF Band Monitor', description: 'Wideband HF monitoring from 3-30 MHz. Waterfall display with signal classifier overlay.', author: 'HF_DXer', authorCallsign: 'G3DX', category: 'amateur', tags: ['hf', 'shortwave', 'monitoring', 'dx'], flowData: {}, rating: 4.7, ratingCount: 98, downloads: 1892, comments: [], createdAt: Date.now() - 86400000 * 60, updatedAt: Date.now() - 86400000 * 1 },
      { id: 'fg-6', name: 'SIGINT Spectrum Survey', description: 'Automated spectrum survey with anomaly detection. Records signal activity over time and flags unusual transmissions.', author: 'SpecOps', category: 'sigint', tags: ['sigint', 'survey', 'anomaly', 'tscm'], flowData: {}, rating: 4.9, ratingCount: 34, downloads: 456, comments: [], createdAt: Date.now() - 86400000 * 10, updatedAt: Date.now() - 86400000 * 1 },
    ];

    this.plugins = [
      { id: 'pl-1', name: 'Meteor-M2 LRPT Decoder', description: 'Advanced LRPT decoder for Meteor-M2 satellites with false-colour compositing', author: 'SatDecode', version: '2.1.0', category: 'satellite', downloads: 892, rating: 4.7, installed: false },
      { id: 'pl-2', name: 'Trunk Recorder', description: 'P25/DMR trunked radio system recorder with talkgroup monitoring', author: 'TrunkRadio', version: '1.5.3', category: 'sigint', downloads: 1245, rating: 4.4, installed: false },
      { id: 'pl-3', name: 'WSPR Decoder', description: 'Weak Signal Propagation Reporter — decode WSPR beacons for propagation mapping', author: 'WSPRNet', version: '1.0.1', category: 'amateur', downloads: 567, rating: 4.2, installed: false },
      { id: 'pl-4', name: 'GOES HRIT Decoder', description: 'Geostationary weather satellite full-resolution image decoder', author: 'GOESTools', version: '3.0.0', category: 'satellite', downloads: 341, rating: 4.8, installed: false },
    ];
  }

  getFlowgraphs(category?: FlowgraphCategory, search?: string): CommunityFlowgraph[] {
    let results = [...this.flowgraphs];
    if (category) results = results.filter(f => f.category === category);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(f => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.tags.some(t => t.includes(q)));
    }
    return results.sort((a, b) => b.downloads - a.downloads);
  }

  getFlowgraph(id: string): CommunityFlowgraph | undefined { return this.flowgraphs.find(f => f.id === id); }

  shareFlowgraph(data: { name: string; description: string; category: FlowgraphCategory; tags: string[]; flowData: any; author: string; authorCallsign?: string }): CommunityFlowgraph {
    const fg: CommunityFlowgraph = { id: `fg-${Date.now()}`, ...data, rating: 0, ratingCount: 0, downloads: 0, comments: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.flowgraphs.push(fg);
    this.emit('flowgraph-shared', fg);
    return fg;
  }

  rateFlowgraph(id: string, rating: number): boolean {
    const fg = this.flowgraphs.find(f => f.id === id);
    if (!fg || rating < 1 || rating > 5) return false;
    fg.rating = (fg.rating * fg.ratingCount + rating) / (fg.ratingCount + 1);
    fg.ratingCount++;
    return true;
  }

  commentOnFlowgraph(id: string, author: string, text: string): CommunityComment | null {
    const fg = this.flowgraphs.find(f => f.id === id);
    if (!fg) return null;
    const comment: CommunityComment = { id: `cmt-${Date.now()}`, author, text, createdAt: Date.now() };
    fg.comments.push(comment);
    return comment;
  }

  getPlugins(category?: FlowgraphCategory): CommunityPlugin[] {
    let results = [...this.plugins];
    if (category) results = results.filter(p => p.category === category);
    return results;
  }

  getProfile(id: string): UserProfile | undefined { return this.profiles.get(id); }

  updateProfile(profile: UserProfile): UserProfile {
    this.profiles.set(profile.id, profile);
    return profile;
  }
}
