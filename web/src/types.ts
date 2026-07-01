export interface Song {
  id: string;
  ministryId: string;
  userId?: string;
  title: string;
  artistId?: string;
  artistName?: string;
  classificationId?: string;
  classificationName?: string;
  classificationColor?: string;
  originalKey?: string;
  bpm?: number;
  duration?: string;
  lyrics?: string;
  chordSheetUrl?: string;
  youtubeUrl?: string;
  audioUrl?: string;
  externalLinks?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  smartChord?: {
    id: string;
    originalKey: string;
    content: string;
  };
}

export interface Artist {
  id: string;
  ministryId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Classification {
  id: string;
  ministryId: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  ministryId: string;
  name: string;
  description?: string;
  songCount: number;
  songs: Song[];
  createdAt: string;
  updatedAt: string;
}

export interface RepertoireCounts {
  songs: number;
  folders: number;
  artists: number;
}

export interface SongFilters {
  originalKey?: string | null;
  hasYoutube?: boolean | null;
  classificationId?: string | null;
}
