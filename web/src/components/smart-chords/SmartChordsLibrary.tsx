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
export function SmartChordsLibrary({
  smartChords,
  artists,
  selectedChordId,
  search,
  isLoading,
  relationsLoading,
  relationsError,
  onImport,
  onRetry,
  handleCreateNew,
  handleSelectChord,
  handleSearchChange,
}: Props) {
  return (
    <div
      className="glass-panel smart-chords-sidebar no-print"
      style={{
        width: '100%',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        flexShrink: 0,
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
      }}
    >
      <div
        className="smart-chords-library-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Minhas Cifras
          </h2>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '999px',
              backgroundColor: 'var(--bg-surface-subtle)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {smartChords.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: '44px', padding: '8px 14px', fontSize: '0.85rem', borderRadius: '8px', display: 'inline-flex', alignItems: 'center' }}
            onClick={onImport}
            title="Importar cifra de PDF ou texto"
          >
            Importar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: '44px', padding: '8px 14px', fontSize: '0.85rem', borderRadius: '8px', display: 'inline-flex', alignItems: 'center' }}
            onClick={handleCreateNew}
          >
            Criar Cifra
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <input
          type="text"
          className="form-control"
          aria-label="Buscar cifra"
          placeholder="Buscar cifra por título ou artista..."
          value={search}
          onChange={handleSearchChange}
          style={{ minHeight: '44px', fontSize: '0.9375rem' }}
        />
      </div>

      {relationsError && (
        <div className="inline-error-state" role="alert">
          <span>{relationsError}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      )}

      <div
        aria-busy={isLoading || relationsLoading}
        className="smart-chords-library-grid"
        style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        {(isLoading || relationsLoading) && smartChords.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>Carregando...</p>
        ) : relationsError ? null : smartChords.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>Nenhuma cifra encontrada.</p>
        ) : (
          smartChords.map((sc) => {
            const itemArtist =
              sc.artistName || sc.artist?.name || artists.find((a) => a.id === sc.artistId)?.name || 'Artista desconhecido';
            const isSelected = selectedChordId === sc.id;
            return (
              <button
                type="button"
                key={sc.id}
                onClick={() => handleSelectChord(sc)}
                style={{
                  padding: '14px 16px',
                  minHeight: '56px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--action-primary-subtle)' : 'var(--bg-surface)',
                  border: `1px solid ${isSelected ? 'var(--action-primary-bg)' : 'var(--border-subtle)'}`,
                  transition: 'background-color 0.15s ease, border-color 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: '6px',
                  width: '100%',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
                className="smart-chord-library-item"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', width: '100%' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {sc.title}
                  </div>
                  <span
                    style={{
                      color: 'var(--chord-text)',
                      backgroundColor: 'var(--chord-badge-bg)',
                      border: '1px solid var(--chord-badge-border)',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      fontFamily: 'var(--font-mono, monospace)',
                      flexShrink: 0,
                    }}
                  >
                    {sc.originalKey}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemArtist}</span>
                  {sc.songId ? (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: 'var(--structural-accent)',
                        backgroundColor: 'var(--structural-subtle)',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        flexShrink: 0,
                      }}
                    >
                      Vinculada
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
