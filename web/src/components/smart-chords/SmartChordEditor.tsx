import type { Song } from '../../types';

interface Props {
  title: string;
  artistName: string;
  originalKey: string;
  songId: string;
  newSongTitle: string;
  content: string;
  handleTitleChange: (value: string) => void;
  setArtistName: (value: string) => void;
  setOriginalKey: (value: string) => void;
  setSongId: (value: string) => void;
  handleNewSongTitleChange: (value: string) => void;
  setContent: (value: string) => void;
  autoCreateSong: boolean;
  setAutoCreateSong: (value: boolean) => void;
  repertoireSongs: Song[];
  relationsLoading: boolean;
  linkLoading: boolean;
}

const keysList = [
  'C', 'Cm', 'C#', 'C#m', 'D', 'Dm', 'Eb', 'Ebm', 'E', 'Em', 'F', 'Fm',
  'F#', 'F#m', 'G', 'Gm', 'G#', 'G#m', 'A', 'Am', 'Bb', 'Bbm', 'B', 'Bm'
];

/** Controlled metadata, repertoire-link inputs and bracket text; no persistence or draft state. */
export function SmartChordEditor({
  title,
  artistName,
  originalKey,
  songId,
  newSongTitle,
  content,
  autoCreateSong,
  repertoireSongs,
  relationsLoading,
  linkLoading,
  handleTitleChange,
  setArtistName,
  setOriginalKey,
  setSongId,
  handleNewSongTitleChange,
  setContent,
  setAutoCreateSong,
}: Props) {
  return (
    <div
      className="glass-panel no-print smart-chords-editor"
      style={{
        flex: 1,
        minWidth: '300px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
      }}
    >
      <div className="smart-chords-metadata">
        <div className="form-group">
          <label className="form-label" htmlFor="smart-chord-title">Título *</label>
          <input
            id="smart-chord-title"
            type="text"
            className="form-control"
            style={{ minHeight: '44px', fontSize: '0.95rem' }}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Ex: Hosana"
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
            <label className="form-label" htmlFor="smart-chord-artist">Artista</label>
            <input
              id="smart-chord-artist"
              type="text"
              className="form-control"
              style={{ minHeight: '44px', fontSize: '0.95rem' }}
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              placeholder="Ex: Gabriela Rocha"
            />
          </div>

          <div className="form-group" style={{ width: '120px' }}>
            <label className="form-label" htmlFor="smart-chord-key">Tom Original *</label>
            <select
              id="smart-chord-key"
              className="form-control"
              style={{ minHeight: '44px', fontSize: '0.95rem', fontWeight: 600 }}
              value={originalKey}
              onChange={(e) => setOriginalKey(e.target.value)}
            >
              {keysList.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Vínculo com Música do Repertório */}
      <details
        className="smart-chords-link"
        style={{
          padding: '8px 14px',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface-subtle)',
        }}
      >
        <summary>
          Vínculo com o repertório
          {songId && songId !== 'new'
            ? `: ${repertoireSongs.find((song) => song.id === songId)?.title || 'Música vinculada'}`
            : ''}
        </summary>
        <div className="form-group" style={{ marginTop: '10px', marginBottom: '4px' }}>
          <label className="form-label">Vincular a uma Música do Repertório</label>
          <select
            className="form-control"
            style={{ minHeight: '44px', fontSize: '0.95rem' }}
            value={songId}
            onChange={(e) => setSongId(e.target.value)}
            disabled={relationsLoading || linkLoading}
          >
            <option value="">Nenhuma música vinculada</option>
            <option value="new" style={{ color: 'var(--chord-text)', fontWeight: 'bold' }}>
              + Nova Música (Auto-Criar)...
            </option>
            {repertoireSongs.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>

          {/* If "new" option is selected, render input text and checkbox */}
          {songId === 'new' && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <div className="form-group">
                <label className="form-label">Nome da Nova Música no Repertório *</label>
                <input
                  type="text"
                  className="form-control"
                  style={{ minHeight: '44px', fontSize: '0.95rem' }}
                  value={newSongTitle}
                  onChange={(e) => {
                    handleNewSongTitleChange(e.target.value);
                  }}
                  placeholder="Nome da música..."
                />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', minHeight: '44px', marginBottom: 0 }}>
                <input
                  type="checkbox"
                  id="auto-create-checkbox"
                  checked={autoCreateSong}
                  onChange={(e) => setAutoCreateSong(e.target.checked)}
                  style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--action-primary-bg)' }}
                />
                <label htmlFor="auto-create-checkbox" className="form-label" style={{ margin: 0, cursor: 'pointer', fontSize: '0.88rem' }}>
                  Criar automaticamente no Repertório ao salvar a cifra
                </label>
              </div>
            </div>
          )}
        </div>
      </details>

      <div className="form-group smart-chords-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <label className="form-label">Conteúdo da Cifra (Formato Bracket) *</label>
        <textarea
          aria-label="Conteúdo bracket da cifra"
          spellCheck={false}
          className="form-control"
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.9375rem',
            resize: 'none',
            minHeight: '280px',
            lineHeight: 1.65,
          }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Ex: [C]Amanhã [G]será outro [Am]dia..."
        />
      </div>
    </div>
  );
}
