import React from 'react';
import { Folder as FolderType } from '../types';
import { Folder, Edit2, Trash2 } from 'lucide-react';

interface FolderCardProps {
  folder: FolderType;
  onTap: () => void;
  onEdit?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({ folder, onTap, onEdit, onDelete }) => {
  return (
    <div
      className="folder-card"
      onClick={onTap}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '16px',
        borderRadius: '14px',
        background: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        minHeight: '130px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      <div className="folder-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div
          className="folder-icon-wrapper"
          style={{
            width: '44px',
            height: '44px',
            minWidth: '44px',
            minHeight: '44px',
            borderRadius: '10px',
            background: 'var(--primary-surface)',
            color: 'var(--primary-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Folder size={22} className="folder-icon" />
        </div>
        {(onEdit || onDelete) && (
          <div className="folder-actions" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {onEdit && (
              <button
                className="action-icon-btn"
                title="Editar pasta"
                onClick={onEdit}
                style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
              >
                <Edit2 size={18} />
              </button>
            )}
            {onDelete && (
              <button
                className="action-icon-btn delete"
                title="Excluir pasta"
                onClick={onDelete}
                style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, marginBottom: '8px' }}>
        <div className="folder-name" style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</div>
        <div className="folder-desc" title={folder.description || ''} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4 }}>
          {folder.description || 'Sem descrição cadastrada.'}
        </div>
      </div>

      <div className="folder-footer" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 600, marginTop: 'auto' }}>
        <span>{folder.songCount === 1 ? '1 música' : `${folder.songCount || 0} músicas`}</span>
      </div>
    </div>
  );
};

