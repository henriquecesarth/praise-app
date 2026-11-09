import React from 'react';
import { Clock3, ExternalLink, FileText, Gauge, Headphones, Layers3, Music2, Youtube } from 'lucide-react';
import { Classification, Song } from '../types';
import './SongCard.css';

interface SongCardProps {
  song: Song;
  onTap: () => void;
  classifications?: Classification[];
}

const formatDuration = (duration?: string): string | undefined => {
  if (!duration) return undefined;
  return duration.replace(/^00:/, '');
};

export const SongCard: React.FC<SongCardProps> = ({ song, onTap, classifications = [] }) => {
  const artist = song.artist || song.artistName || 'Artista não especificado';
  const primaryVersion = song.versions?.[0];
  const key = primaryVersion?.key || song.originalKey;
  const bpm = primaryVersion?.bpm ?? song.bpm;
  const duration = formatDuration(primaryVersion?.duration || song.duration);
  const versions = song.versions?.length ?? 0;
  const links = primaryVersion?.links ?? [];
  const activeLinks = links.filter(link => Boolean(link.url?.trim()));
  const classificationIds = primaryVersion?.classificationIds ?? [];
  const classificationBadges = classificationIds
    .map(id => classifications.find(classification => classification.id === id))
    .filter((classification): classification is Classification => Boolean(classification));
  if (classificationBadges.length === 0 && song.classificationName) {
    classificationBadges.push({
      id: song.classificationId || song.classificationName,
      ministryId: song.ministryId || '',
      name: song.classificationName,
      color: song.classificationColor,
      createdAt: '',
      updatedAt: '',
    });
  }
  const hasYoutube = Boolean(song.youtubeUrl?.trim()) || activeLinks.some(link => /youtube|youtu\.be|vídeo|video/i.test(`${link.label} ${link.url}`));
  const hasAudio = Boolean(song.audioUrl?.trim()) || activeLinks.some(link => /áudio|audio|spotify|deezer/i.test(`${link.label} ${link.url}`));
  const hasChordResource = Boolean(song.chordSheetUrl?.trim()) || activeLinks.some(link => /cifra/i.test(`${link.label} ${link.url}`));
  const hasLyricsResource = Boolean(song.externalLinks?.letras?.trim()) || activeLinks.some(link => /letra/i.test(`${link.label} ${link.url}`));

  return (
    <button
      type="button"
      className="louvaio-song-row"
      onClick={onTap}
      aria-label={`Abrir música ${song.title}, ${artist}`}
    >
      <span className="louvaio-song-row__main">
        <span className="louvaio-song-row__title" title={song.title}>{song.title}</span>
        <span className="louvaio-song-row__artist" title={artist}>{artist}</span>
      </span>

      {versions > 1 && (
        <span className="louvaio-song-row__versions" title={song.versions.map(version => version.name).join(', ')}>
          <Layers3 aria-hidden="true" size={14} />
          {versions} versões
        </span>
      )}

      <span className="louvaio-song-row__meta">
        {key && <span className="louvaio-song-row__key"><Music2 aria-hidden="true" size={13} />{key}</span>}
        {bpm !== undefined && bpm !== null && bpm !== '' && <span className="louvaio-song-row__detail"><Gauge aria-hidden="true" size={13} />{bpm} BPM</span>}
        {duration && <span className="louvaio-song-row__detail"><Clock3 aria-hidden="true" size={13} />{duration}</span>}
        {classificationBadges.map(classification => (
          <span
            key={classification.id}
            className="louvaio-song-row__classification"
            style={classification.color ? { '--song-classification-color': classification.color } as React.CSSProperties : undefined}
          >{classification.name}</span>
        ))}
      </span>

      <span className="louvaio-song-row__resources" aria-label="Recursos disponíveis">
        {hasYoutube && <span title="YouTube" aria-label="YouTube"><Youtube aria-hidden="true" size={15} /></span>}
        {hasAudio && <span title="Áudio" aria-label="Áudio"><Headphones aria-hidden="true" size={14} /></span>}
        {hasLyricsResource && <span title="Letra" aria-label="Letra"><FileText aria-hidden="true" size={14} /></span>}
        {hasChordResource && <span title="Cifra externa" aria-label="Cifra externa"><ExternalLink aria-hidden="true" size={14} /></span>}
      </span>
    </button>
  );
};
