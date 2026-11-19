import type { CanonicalStemId } from './separation/demucs-onnx-separator';

export const MAX_MINISTRY_AUDIO_SECONDS = 300;
export const MIN_MINISTRY_AUDIO_SAMPLE_RATE = 8000;
export const MAX_MINISTRY_AUDIO_SAMPLE_RATE = 48000;
export const MAX_MINISTRY_STEM_BYTES = 44 + MAX_MINISTRY_AUDIO_SECONDS * MAX_MINISTRY_AUDIO_SAMPLE_RATE * 4;

export interface MinistryAudioMetadata {
  title: string;
  artist: string;
  version: string;
}

export interface MinistryAudioModel {
  id: string;
  version: string;
}

export interface MinistryAudioStem {
  id: CanonicalStemId;
  codec: 'pcm_s16le';
  sampleRate: number;
  channels: 2;
  durationSeconds: number;
  frames: number;
  sizeBytes: number;
  sha256: string;
}

export interface MinistryAudioRecord extends MinistryAudioMetadata {
  id: string;
  status: 'published' | 'archived';
  updatedAt: number;
}

export interface MinistryAudioPage {
  items: MinistryAudioRecord[];
  nextCursor: string | null;
}

export interface MinistryAudioUpload {
  id: string;
  status: 'uploading' | 'published' | 'archived' | 'expired';
  uploadedStemIds: CanonicalStemId[];
  expiresAt: number;
  transfer?: 'direct';
}

export interface MinistryAudioUploadGrant {
  attempt: number;
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}

export interface MinistryAudioReservation extends MinistryAudioMetadata {
  idempotencyKey: string;
  confirmed: true;
  model: MinistryAudioModel;
  stems: MinistryAudioStem[];
}

export interface MinistryAudioPlaybackTrack {
  id: CanonicalStemId;
  url: string;
  headers?: Record<string, string>;
}

export interface MinistryAudioPlayback {
  manifest: {
    schemaVersion: 1;
    recordingId: string;
    recordingVersion: string;
    model: MinistryAudioModel;
    stems: MinistryAudioStem[];
  };
  tracks: MinistryAudioPlaybackTrack[];
  expiresAt: number;
  transfer?: 'direct';
}
