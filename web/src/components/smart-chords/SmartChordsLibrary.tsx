import type { ChangeEventHandler } from 'react';
import type { SmartChord } from '../../api';
import type { Artist } from '../../types';

interface Props {
  smartChords: SmartChord[];
  artists: Artist[];
  selectedChordId?: string;
  search: string;
  isLoading: boolean;
  relationsLoading: boolean;
  relationsError: string | null;
  onImport: () => void;
  onRetry: () => void;
  handleCreateNew: () => void;
  handleSelectChord: (chord: SmartChord) => void;
  handleSearchChange: ChangeEventHandler<HTMLInputElement>;
}

/** Controlled library: loading, search and selection remain owned by the workspace. */
export function SmartChordsLibrary({ smartChords, artists, selectedChordId, search, isLoading, relationsLoading, relationsError, onImport, onRetry, handleCreateNew, handleSelectChord, handleSearchChange }: Props) {
  return (
    <div className="glass-panel smart-chords-sidebar no-print" style={{ width: '320px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Minhas Cifras</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: '44px', padding: '8px 12px', fontSize: '0.85rem', borderRadius: '8px', display: 'inline-flex', alignItems: 'center' }}
            onClick={onImport}
            title="Importar cifra de PDF ou texto"
          >
            Importar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: '44px', padding: '8px 12px', fontSize: '0.85rem', borderRadius: '8px', display: 'inline-flex', alignItems: 'center' }}
            onClick={handleCreateNew}
          >
            Criar Cifra
          </button>
        </div>
      </div>

      <input
        type="text"
        className="form-control"
        aria-label="Buscar cifra"
        placeholder="Buscar cifra..."
        value={search}
        onChange={handleSearchChange}
        style={{ minHeight: '44px', fontSize: '0.95rem' }}
      />

      {relationsError && (
        <div className="inline-error-state" role="alert">
          <span>{relationsError}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      )}

      <div aria-busy={isLoading || relationsLoading} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(isLoading || relationsLoading) && smartChords.length === 0 ? (
          <p style={{ textAlign: 'center', opacity: 0.5 }}>Carregando...</p>
        ) : relationsError ? null : smartChords.length === 0 ? (
          <p style={{ textAlign: 'center', opacity: 0.5 }}>Nenhuma cifra encontrada.</p>
        ) : (
          smartChords.map(sc => {
            const itemArtist = sc.artistName || sc.artist?.name || artists.find(a => a.id === sc.artistId)?.name || 'Artista desconhecido';
            return (
              <button
                type="button"
                key={sc.id}
                onClick={() => handleSelectChord(sc)}
                style={{
                  padding: '12px 14px',
                  minHeight: '44px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  backgroundColor: selectedChordId === sc.id ? 'var(--primary-surface)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${selectedChordId === sc.id ? 'var(--primary)' : 'transparent'}`,
                  transition: 'all 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  width: '100%',
                  color: 'inherit',
                  textAlign: 'left'
                }}
                className="hover-scale"
              >
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{sc.title}</div>
                <div style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{itemArtist}</span>
                  <span style={{ color: 'var(--primary-light)', fontWeight: 600 }}>{sc.originalKey}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
