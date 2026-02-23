// ============================================================================
// SignalForge — SSTV Decoder Service
// ============================================================================
import { EventEmitter } from 'events';
import type { SSTVImage, SSTVMode, SSTVConfig, SSTVStatus, SSTV_BANDS } from '@signalforge/shared';

const MODES: { mode: SSTVMode; width: number; height: number }[] = [
  { mode: 'Martin1', width: 320, height: 256 }, { mode: 'Martin2', width: 320, height: 256 },
  { mode: 'Scottie1', width: 320, height: 256 }, { mode: 'Scottie2', width: 320, height: 256 },
  { mode: 'Robot36', width: 320, height: 240 }, { mode: 'Robot72', width: 320, height: 240 },
  { mode: 'PD90', width: 320, height: 256 }, { mode: 'PD120', width: 640, height: 496 },
  { mode: 'PD180', width: 640, height: 496 }, { mode: 'PD240', width: 640, height: 496 },
];

export class SSTVService extends EventEmitter {
  private gallery: SSTVImage[] = [];
  private config: SSTVConfig = {
    enabled: false, monitoredBands: ['ISS', '20m'], autoDetect: true, saveImages: true, galleryPath: './sstv-gallery',
  };
  private receiving = false;
  private currentMode: SSTVMode | null = null;
  private demoInterval: ReturnType<typeof setInterval> | null = null;

  getGallery(limit = 50): SSTVImage[] { return this.gallery.slice(0, limit); }
  getImage(id: string): SSTVImage | undefined { return this.gallery.find(i => i.id === id); }

  getStatus(): SSTVStatus {
    return {
      active: this.config.enabled, currentMode: this.currentMode, receiving: this.receiving,
      imagesDecoded: this.gallery.filter(i => i.complete).length,
      monitoredFrequencies: [],
    };
  }

  getConfig(): SSTVConfig { return this.config; }
  updateConfig(cfg: Partial<SSTVConfig>): SSTVConfig { Object.assign(this.config, cfg); return this.config; }

  addNote(id: string, notes: string): SSTVImage | undefined {
    const img = this.gallery.find(i => i.id === id);
    if (img) img.notes = notes;
    return img;
  }

  startDemo() {
    if (this.demoInterval) return;
    this.config.enabled = true;
    const sources = ['ISS 145.800 MHz', '20m 14.230 MHz', '40m 7.171 MHz'];
    this.demoInterval = setInterval(() => {
      const modeInfo = MODES[Math.floor(Math.random() * MODES.length)];
      const source = sources[Math.floor(Math.random() * sources.length)];
      // Generate a simple coloured gradient as base64 "thumbnail"
      const img: SSTVImage = {
        id: `sstv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(), mode: modeInfo.mode,
        frequency: source.includes('ISS') ? 145.8e6 : source.includes('20m') ? 14.23e6 : 7.171e6,
        width: modeInfo.width, height: modeInfo.height, progress: 100, complete: true,
        source, snr: 10 + Math.random() * 20,
      };
      this.gallery.unshift(img);
      if (this.gallery.length > 200) this.gallery = this.gallery.slice(0, 200);
      this.emit('image', img);
    }, 20000);
  }

  stopDemo() {
    if (this.demoInterval) { clearInterval(this.demoInterval); this.demoInterval = null; }
    this.config.enabled = false;
  }
}
