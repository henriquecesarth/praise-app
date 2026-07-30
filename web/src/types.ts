export type MinistryRole = 'admin' | 'member';
export type GroupRole = MinistryRole;

export interface Ministry {
  id: string;
  name: string;
  slug?: string;
  ownerUserId: string;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
  role: MinistryRole;
  createdAt: string;
  updatedAt: string;
}

export type Group = Ministry;

export interface MinistryMember {
  id: string;
  ministryId: string;
  userId: string;
  role: MinistryRole;
  joinedAt: string;
}

export type GroupMember = MinistryMember;

export interface MinistryInvite {
  id: string;
  ministryId: string;
  code: string;
  createdBy: string;
  maxUses?: number;
  usesCount: number;
  expiresAt?: string;
  createdAt: string;
}

export type GroupInvite = MinistryInvite;

export interface LiturgyItem {
  id: string;
  liturgyId: string;
  songId?: string;
  song?: Song;
  type: 'song' | 'reading' | 'prayer' | 'custom';
  title: string;
  notes?: string;
  position: number;
}

export interface Liturgy {
  id: string;
  ministryId: string;
  title: string;
  date: string;
  description?: string;
  createdBy: string;
  items?: LiturgyItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SongLink {
  id?: string;
  label: string; // Ex: 'Letra', 'Cifra', 'Áudio', 'Vídeo' ou rótulo customizado
  url: string;
  isCustom?: boolean;
}

export interface SongVersion {
  id: string;
  name: string; // Padrão da primeira versão: "Original"
  classificationIds: string[]; // Classificações da versão
  notes?: string; // Observações específicas desta versão
  key: string; // Tom (ex: "G", "C#m")
  bpm?: string | number; // BPM (ex: 120)
  duration?: string; // Duração formatada em HH:MM:SS
  links: SongLink[]; // 4 links padrão + links customizados
}

export interface Song {
  id: string;
  ministryId?: string;
  userId?: string;
  title: string;
  artist: string; // Texto livre (sem dropdown/sem vínculo com entidade Artista)
  notes?: string; // Observações gerais da música
  versions: SongVersion[]; // Lista de versões (mínimo 1)
  createdAt?: string;
  updatedAt?: string;

  // Propriedades retrocompatíveis opcionais
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
