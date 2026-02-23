// Waterfall Spectrogram Recording Types

export interface WaterfallRecording {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  frequency: number;
  bandwidth: number;
  mode: string;
  format: 'png' | 'webm';
  filePath?: string;
  thumbnailPath?: string;
  annotations: WaterfallAnnotation[];
  timelapse: boolean;
  timelapseInterval?: number; // seconds between captures
  sizeBytes?: number;
  status: 'recording' | 'complete' | 'error';
}

export interface WaterfallAnnotation {
  id: string;
  type: 'timestamp' | 'frequency' | 'label' | 'region';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  frequency?: number;
  time?: number;
  text: string;
  color: string;
}

export interface SpectrogramGalleryItem {
  id: string;
  name: string;
  timestamp: number;
  frequency: number;
  bandwidth: number;
  mode: string;
  thumbnailUrl: string;
  fullUrl: string;
  duration: number;
  annotations: number;
  timelapse: boolean;
  tags: string[];
}
