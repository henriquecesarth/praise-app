import React from 'react';
import { Folder as FolderType } from '../types';
import { Folder, Edit2, Trash2 } from 'lucide-react';

interface FolderCardProps {
  folder: FolderType;
  onTap: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({ folder, onTap, onEdit, onDelete }) => {
  return (
    <div className="folder-card" onClick={onTap}>
      <div className="folder-header">
        <Folder size={32} className="folder-icon" style={{ color: 'var(--primary-light)' }} />
        <div className="folder-actions" onClick={(e) => e.stopPropagation()}>
          <button className="action-icon-btn" title="Editar pasta" onClick={onEdit}>
            <Edit2 size={16} />
          </button>
          <button className="action-icon-btn delete" title="Excluir pasta" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div>
        <div className="folder-name">{folder.name}</div>
        <div className="folder-desc" title={folder.description || ''}>
          {folder.description || 'Sem descrição cadastrada.'}
        </div>
      </div>
      <div className="folder-footer">
        <span>{folder.songCount === 1 ? '1 música' : `${folder.songCount || 0} músicas`}</span>
      </div>
    </div>
  );
};
