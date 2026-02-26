/**
 * Frequency Profile Manager
 * Load/save/activate frequency scanning profiles
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ReceiverDef {
  freq: number;
  mode: string;
  bw: number;
  label: string;
  decoder?: string;
}

export interface FrequencyProfile {
  name: string;
  centerFreq: number;
  sampleRate: number;
  gain: number;
  receivers: ReceiverDef[];
  builtIn?: boolean;
}

export interface ProfilesConfig {
  profiles: Record<string, FrequencyProfile>;
}

const PROFILES_PATH = join(__dirname, '..', '..', 'config', 'frequency-profiles.json');
const CUSTOM_PROFILES_PATH = join(__dirname, '..', '..', 'config', 'custom-profiles.json');

let activeProfileId: string | null = null;
let previousProfileId: string | null = null;

export function loadProfiles(): ProfilesConfig {
  const config: ProfilesConfig = { profiles: {} };

  // Load built-in profiles
  if (existsSync(PROFILES_PATH)) {
    try {
      const data = JSON.parse(readFileSync(PROFILES_PATH, 'utf-8'));
      for (const [id, profile] of Object.entries(data.profiles || {})) {
        config.profiles[id] = { ...(profile as FrequencyProfile), builtIn: true };
      }
    } catch (err) {
      console.error('Failed to load frequency profiles:', err);
    }
  }

  // Load custom profiles
  if (existsSync(CUSTOM_PROFILES_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CUSTOM_PROFILES_PATH, 'utf-8'));
      for (const [id, profile] of Object.entries(data.profiles || {})) {
        config.profiles[id] = { ...(profile as FrequencyProfile), builtIn: false };
      }
    } catch (err) {
      console.error('Failed to load custom profiles:', err);
    }
  }

  return config;
}

export function saveCustomProfile(id: string, profile: FrequencyProfile): void {
  let customs: { profiles: Record<string, FrequencyProfile> } = { profiles: {} };
  if (existsSync(CUSTOM_PROFILES_PATH)) {
    try {
      customs = JSON.parse(readFileSync(CUSTOM_PROFILES_PATH, 'utf-8'));
    } catch {}
  }
  customs.profiles[id] = profile;
  writeFileSync(CUSTOM_PROFILES_PATH, JSON.stringify(customs, null, 2));
}

export function deleteCustomProfile(id: string): boolean {
  if (!existsSync(CUSTOM_PROFILES_PATH)) return false;
  try {
    const customs = JSON.parse(readFileSync(CUSTOM_PROFILES_PATH, 'utf-8'));
    if (!customs.profiles[id]) return false;
    delete customs.profiles[id];
    writeFileSync(CUSTOM_PROFILES_PATH, JSON.stringify(customs, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function getActiveProfileId(): string | null {
  return activeProfileId;
}

export function setActiveProfileId(id: string | null): void {
  if (id !== null) {
    previousProfileId = activeProfileId;
  }
  activeProfileId = id;
}

export function getPreviousProfileId(): string | null {
  return previousProfileId;
}
