import { EventEmitter } from 'events';
import type { WaterfallRecording, WaterfallAnnotation, SpectrogramGalleryItem } from '@signalforge/shared';

export class WaterfallRecorder extends EventEmitter {
  private recordings = new Map<string, WaterfallRecording>();
  private gallery: SpectrogramGalleryItem[] = [];

  startRecording(opts: { name: string; frequency: number; bandwidth: number; mode: string; format: 'png' | 'webm'; timelapse?: boolean; timelapseInterval?: number }): WaterfallRecording {
    const rec: WaterfallRecording = {
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: opts.name,
      startTime: Date.now(),
      frequency: opts.frequency,
      bandwidth: opts.bandwidth,
      mode: opts.mode,
      format: opts.format,
      annotations: [],
      timelapse: opts.timelapse || false,
      timelapseInterval: opts.timelapseInterval,
      status: 'recording',
    };
    this.recordings.set(rec.id, rec);
    this.emit('recording_started', rec);
    return rec;
  }

  stopRecording(id: string): WaterfallRecording | null {
    const rec = this.recordings.get(id);
    if (!rec) return null;
    rec.endTime = Date.now();
    rec.status = 'complete';
    rec.sizeBytes = Math.floor(Math.random() * 5000000) + 100000; // demo

    // Add to gallery
    this.gallery.unshift({
      id: rec.id,
      name: rec.name,
      timestamp: rec.startTime,
      frequency: rec.frequency,
      bandwidth: rec.bandwidth,
      mode: rec.mode,
      thumbnailUrl: `/api/waterfall/recordings/${rec.id}/thumbnail`,
      fullUrl: `/api/waterfall/recordings/${rec.id}/file`,
      duration: (rec.endTime - rec.startTime) / 1000,
      annotations: rec.annotations.length,
      timelapse: rec.timelapse,
      tags: [],
    });

    this.emit('recording_stopped', rec);
    return rec;
  }

  addAnnotation(recordingId: string, annotation: Omit<WaterfallAnnotation, 'id'>): WaterfallAnnotation | null {
    const rec = this.recordings.get(recordingId);
    if (!rec) return null;
    const ann: WaterfallAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
      ...annotation,
    };
    rec.annotations.push(ann);
    this.emit('annotation_added', { recordingId, annotation: ann });
    return ann;
  }

  removeAnnotation(recordingId: string, annotationId: string): boolean {
    const rec = this.recordings.get(recordingId);
    if (!rec) return false;
    const idx = rec.annotations.findIndex(a => a.id === annotationId);
    if (idx === -1) return false;
    rec.annotations.splice(idx, 1);
    return true;
  }

  getRecording(id: string): WaterfallRecording | undefined {
    return this.recordings.get(id);
  }

  getActiveRecordings(): WaterfallRecording[] {
    return [...this.recordings.values()].filter(r => r.status === 'recording');
  }

  getGallery(limit = 50): SpectrogramGalleryItem[] {
    return this.gallery.slice(0, limit);
  }

  deleteRecording(id: string): boolean {
    this.recordings.delete(id);
    this.gallery = this.gallery.filter(g => g.id !== id);
    return true;
  }
}
