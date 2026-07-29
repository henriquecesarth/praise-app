import React, { useState } from 'react';
import { SongFilters } from '../types';

interface FilterPopoverProps {
  filters: SongFilters;
  onApply: (filters: SongFilters) => void;
  onClose: () => void;
}

const MUSICAL_KEYS = [
  'C', 'C#', 'D', 'Eb', 'E', 'F',
  'F#', 'G', 'Ab', 'A', 'Bb', 'B',
];

export const FilterPopover: React.FC<FilterPopoverProps> = ({ filters, onApply, onClose }) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(filters.originalKey || null);
  const [hasYoutube, setHasYoutube] = useState<boolean>(filters.hasYoutube || false);

  const handleKeyToggle = (key: string) => {
    if (selectedKey === key) {
      setSelectedKey(null);
    } else {
      setSelectedKey(key);
    }
  };

  const handleClear = () => {
    setSelectedKey(null);
    setHasYoutube(false);
    onApply({ originalKey: null, hasYoutube: null });
    onClose();
  };

  const handleApply = () => {
    onApply({
      originalKey: selectedKey,
      hasYoutube: hasYoutube ? true : null,
    });
    onClose();
  };

  return (
    <div
      className="filter-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        className="filter-dropdown bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'var(--surface-color)',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          border: '1px solid var(--border-color)',
          padding: '16px 20px max(24px, var(--safe-area-bottom))',
          boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Handle visual no topo do Bottom Sheet */}
        <div style={{ width: '40px', height: '4px', background: 'var(--border-color)', borderRadius: '2px', alignSelf: 'center', marginBottom: '4px' }} />

        <div className="filter-title" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Filtros do Repertório</span>
          <button
            onClick={onClose}
            style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            ✕
          </button>
        </div>
        
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px' }}>Tom Original</div>
          <div className="keys-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
            {MUSICAL_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`key-chip ${selectedKey === key ? 'active' : ''}`}
                onClick={() => handleKeyToggle(key)}
                style={{
                  minWidth: '44px',
                  minHeight: '44px',
                  borderRadius: '10px',
                  border: selectedKey === key ? '2px solid var(--primary-brand)' : '1px solid var(--border-color)',
                  background: selectedKey === key ? 'var(--primary-surface)' : 'var(--surface-variant)',
                  color: selectedKey === key ? 'var(--primary-light)' : 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: '4px 0' }} />

        <div className="switch-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: '44px' }}>
          <div className="switch-label-block">
            <span style={{ fontSize: '0.9rem', fontWeight: 700, display: 'block', color: 'var(--text-primary)' }}>Apenas com YouTube</span>
            <span className="switch-desc" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Mostrar músicas com vídeo de referência</span>
          </div>
          <label className="toggle-switch" style={{ width: '48px', height: '28px', minHeight: '44px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hasYoutube}
              onChange={(e) => setHasYoutube(e.target.checked)}
              style={{ width: '44px', height: '44px', cursor: 'pointer' }}
            />
            <span className="switch-slider"></span>
          </label>
        </div>

        <div className="filter-actions" style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, minHeight: '44px', padding: '10px 16px', fontSize: '0.9rem', fontWeight: 600, borderRadius: '12px' }}
            onClick={handleClear}
          >
            Limpar
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1, minHeight: '44px', padding: '10px 16px', fontSize: '0.9rem', fontWeight: 600, borderRadius: '12px' }}
            onClick={handleApply}
          >
            Aplicar Filtros
          </button>
        </div>
      </div>
    </div>
  );
};

