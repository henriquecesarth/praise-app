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
    <div className="filter-dropdown" onClick={(e) => e.stopPropagation()}>
      <div className="filter-title">Filtros</div>
      
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Tom</div>
        <div className="keys-grid">
          {MUSICAL_KEYS.map((key) => (
            <div
              key={key}
              className={`key-chip ${selectedKey === key ? 'active' : ''}`}
              onClick={() => handleKeyToggle(key)}
            >
              {key}
            </div>
          ))}
        </div>
      </div>

      <hr style={{ border: 'none', borderBottom: '1px solid var(--divider-color)' }} />

      <div className="switch-row">
        <div className="switch-label-block">
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Apenas com YouTube</span>
          <span className="switch-desc">Mostrar músicas com vídeo de referência</span>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={hasYoutube}
            onChange={(e) => setHasYoutube(e.target.checked)}
          />
          <span className="switch-slider"></span>
        </label>
      </div>

      <div className="filter-actions">
        <button className="btn btn-secondary" style={{ flex: 1, padding: '8px' }} onClick={handleClear}>
          Limpar
        </button>
        <button className="btn btn-primary" style={{ flex: 1, padding: '8px' }} onClick={handleApply}>
          Aplicar
        </button>
      </div>
    </div>
  );
};
