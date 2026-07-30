import React from 'react';
import { Song, Artist, Classification } from '../types';
import { CreateSongModal } from './CreateSongModal';

interface SongFormModalProps {
  song?: Song | null;
  artists?: Artist[];
  classifications: Classification[];
  onSave: (songData: Partial<Song>) => Promise<void>;
  onClose: () => void;
}

export const SongFormModal: React.FC<SongFormModalProps> = ({
  song,
  classifications,
  onSave,
  onClose,
}) => {
  return (
    <CreateSongModal
      song={song}
      classifications={classifications}
      onSave={onSave}
      onClose={onClose}
    />
  );
};
