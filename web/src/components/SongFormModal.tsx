import React, { useState, useEffect } from 'react';
import { ChevronLeft, X, Check } from 'lucide-react';
import { Song, Artist, Classification } from '../types';

interface SongFormModalProps {
  song?: Song | null; // Null means create mode
  artists: Artist[];
  classifications: Classification[];
  onSave: (songData: Partial<Song>) => Promise<void>;
  onClose: () => void;
}

const MUSICAL_KEYS = [
  'C', 'C#', 'D', 'Eb', 'E', 'F',
  'F#', 'G', 'Ab', 'A', 'Bb', 'B',
];

export const SongFormModal: React.FC<SongFormModalProps> = ({
  song,
  artists,
  classifications,
  onSave,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [artistId, setArtistId] = useState('');
  const [classificationId, setClassificationId] = useState('');
  const [originalKey, setOriginalKey] = useState('');
  const [bpm, setBpm] = useState('');
  const [duration, setDuration] = useState('');
  const [lyrics, setLyrics] = useState('');
  
  // Links
  const [chordSheetUrl, setChordSheetUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  
  // Streaming links
  const [spotify, setSpotify] = useState('');
  const [deezer, setDeezer] = useState('');
  const [appleMusic, setAppleMusic] = useState('');
  const [amazonMusic, setAmazonMusic] = useState('');
  const [youtubeMusic, setYoutubeMusic] = useState('');
  const [letras, setLetras] = useState('');

  // Initializing if editing
  useEffect(() => {
    if (song) {
      setTitle(song.title || '');
      setArtistId(song.artistId || '');
      setClassificationId(song.classificationId || '');
      setOriginalKey(song.originalKey || '');
      setBpm(song.bpm?.toString() || '');
      
      // Clean duration (remove leading 00:)
      let initialDuration = song.duration || '';
      if (initialDuration.startsWith('00:')) {
        initialDuration = initialDuration.replace(/^00:/, '');
      }
      setDuration(initialDuration);
      
      setLyrics(song.lyrics || '');
      setChordSheetUrl(song.chordSheetUrl || '');
      setYoutubeUrl(song.youtubeUrl || '');
      setAudioUrl(song.audioUrl || '');
      
      const ext = song.externalLinks || {};
      setSpotify(ext.spotify || '');
      setDeezer(ext.deezer || '');
      setAppleMusic(ext.apple_music || '');
      setAmazonMusic(ext.amazon_music || '');
      setYoutubeMusic(ext.youtube_music || '');
      setLetras(ext.letras || '');
    } else {
      setTitle('');
      setArtistId('');
      setClassificationId('');
      setOriginalKey('');
      setBpm('');
      setDuration('');
      setLyrics('');
      setChordSheetUrl('');
      setYoutubeUrl('');
      setAudioUrl('');
      setSpotify('');
      setDeezer('');
      setAppleMusic('');
      setAmazonMusic('');
      setYoutubeMusic('');
      setLetras('');
    }
  }, [song]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('O título é obrigatório.');
      return;
    }

    setLoading(true);
    setError(null);

    // Format duration to '00:MM:SS' if MM:SS is provided
    let formattedDuration: string | null = null;
    if (duration.trim() && duration !== '00:00') {
      const parts = duration.split(':');
      if (parts.length === 2) {
        formattedDuration = `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
      } else if (parts.length === 3) {
        formattedDuration = duration;
      }
    }

    const songData: Partial<Song> = {
      title: title.trim(),
      artistId: artistId || undefined,
      classificationId: classificationId || undefined,
      originalKey: originalKey || undefined,
      bpm: bpm ? parseFloat(bpm) : undefined,
      duration: formattedDuration || undefined,
      lyrics: lyrics.trim() || undefined,
      chordSheetUrl: chordSheetUrl.trim() || undefined,
      youtubeUrl: youtubeUrl.trim() || undefined,
      audioUrl: audioUrl.trim() || undefined,
      externalLinks: {
        ...(spotify.trim() ? { spotify: spotify.trim() } : {}),
        ...(deezer.trim() ? { deezer: deezer.trim() } : {}),
        ...(appleMusic.trim() ? { apple_music: appleMusic.trim() } : {}),
        ...(amazonMusic.trim() ? { amazon_music: amazonMusic.trim() } : {}),
        ...(youtubeMusic.trim() ? { youtube_music: youtubeMusic.trim() } : {}),
        ...(letras.trim() ? { letras: letras.trim() } : {}),
      },
    };

    try {
      await onSave(songData);
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro ao salvar a música.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large song-form-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header Responsivo em 3 Seções com Touch Targets 44x44px */}
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <button 
            type="button"
            className="action-icon-btn" 
            onClick={onClose} 
            title="Fechar"
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
          >
            <ChevronLeft size={22} className="mobile-only" />
            <X size={20} className="desktop-only" />
          </button>
          
          <div className="modal-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
            {song ? 'Editar Música' : 'Nova Música'}
          </div>

          <button
            type="button"
            className="action-icon-btn"
            onClick={handleSubmit}
            disabled={loading}
            title="Salvar Música"
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', color: 'var(--primary-light)' }}
          >
            <Check size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="song-form-body">
            {error && (
              <div style={{ color: 'var(--error-color)', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: 'var(--border-radius-sm)', marginBottom: '16px', fontSize: '0.9rem', fontWeight: 500 }}>
                {error}
              </div>
            )}

            <div className="song-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
              {/* Left Column: Basic Info */}
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary-light)', marginBottom: '12px', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                  Informações Básicas
                </div>
                
                <div className="form-group">
                  <label>Título *</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ex: Aclame ao SENHOR"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ minHeight: '44px' }}
                    required
                  />
                </div>

                <div className="form-group row-2">
                  <div>
                    <label>Artista</label>
                    <select
                      className="select-field"
                      value={artistId}
                      onChange={(e) => setArtistId(e.target.value)}
                      style={{ minHeight: '44px' }}
                    >
                      <option value="">Nenhum</option>
                      {artists.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Classificação</label>
                    <select
                      className="select-field"
                      value={classificationId}
                      onChange={(e) => setClassificationId(e.target.value)}
                      style={{ minHeight: '44px' }}
                    >
                      <option value="">Nenhuma</option>
                      {classifications.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group row-3">
                  <div>
                    <label>Tom Original</label>
                    <select
                      className="select-field"
                      value={originalKey}
                      onChange={(e) => setOriginalKey(e.target.value)}
                      style={{ minHeight: '44px' }}
                    >
                      <option value="">Nenhum</option>
                      {MUSICAL_KEYS.map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>BPM</label>
                    <input
                      type="number"
                      className="input-field"
                      placeholder="Ex: 120"
                      value={bpm}
                      onChange={(e) => setBpm(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                  <div>
                    <label>Duração (MM:SS)</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Ex: 04:30"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Letra</label>
                  <textarea
                    className="textarea-field"
                    placeholder="Cole a letra da música aqui..."
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    style={{ minHeight: '140px' }}
                  />
                </div>
              </div>

              {/* Right Column: Links and Streaming */}
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary-light)', marginBottom: '12px', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                  Links & Arquivos
                </div>

                <div className="form-group">
                  <label>URL da Cifra (Cifra Club ou Google Drive)</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="https://..."
                    value={chordSheetUrl}
                    onChange={(e) => setChordSheetUrl(e.target.value)}
                    style={{ minHeight: '44px' }}
                  />
                </div>

                <div className="form-group row-2">
                  <div>
                    <label>URL do YouTube (Vídeo)</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                  <div>
                    <label>URL do Áudio (MP3 / Drive)</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://..."
                      value={audioUrl}
                      onChange={(e) => setAudioUrl(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>

                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary-light)', marginTop: '20px', marginBottom: '12px', borderBottom: '1px solid var(--divider-color)', paddingBottom: '4px' }}>
                  Plataformas de Streaming
                </div>

                <div className="form-group row-2">
                  <div>
                    <label>Spotify</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://open.spotify..."
                      value={spotify}
                      onChange={(e) => setSpotify(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                  <div>
                    <label>Deezer</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://deezer..."
                      value={deezer}
                      onChange={(e) => setDeezer(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>

                <div className="form-group row-2">
                  <div>
                    <label>Apple Music</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://music.apple..."
                      value={appleMusic}
                      onChange={(e) => setAppleMusic(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                  <div>
                    <label>Amazon Music</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://music.amazon..."
                      value={amazonMusic}
                      onChange={(e) => setAmazonMusic(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>

                <div className="form-group row-2">
                  <div>
                    <label>YouTube Music</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://music.youtube..."
                      value={youtubeMusic}
                      onChange={(e) => setYoutubeMusic(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                  <div>
                    <label>URL do Letras.mus.br</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://www.letras..."
                      value={letras}
                      onChange={(e) => setLetras(e.target.value)}
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="form-actions" style={{ padding: '12px 16px', display: 'flex', gap: '12px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading} style={{ minHeight: '44px', flex: 1 }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ minHeight: '44px', flex: 1 }}>
              {loading ? 'Salvando...' : 'Salvar música'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

