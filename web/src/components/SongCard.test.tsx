import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SongCard } from './SongCard';
import { Song } from '../types';

describe('SongCard F-R1-01 Regression: Safe Artist Rendering', () => {
  it('deve renderizar normalmente quando song.artist é uma string livre', () => {
    const song: Song = {
      id: 'song-1',
      title: 'Lugar Secreto',
      artist: 'Gabriela Rocha',
      versions: [{ id: 'v1', name: 'Original', key: 'C', classificationIds: [], links: [] }],
    };

    render(<SongCard song={song} onTap={vi.fn()} />);
    expect(screen.getByText('Lugar Secreto')).toBeInTheDocument();
    expect(screen.getByText('Gabriela Rocha')).toBeInTheDocument();
  });

  it('NÃO deve quebrar a renderização React caso song.artist seja fornecido como objeto (defesa contra crash de React child)', () => {
    const songWithObjArtist = {
      id: 'song-2',
      title: 'A Batalha',
      artist: { id: 'art-1', name: 'Diante do Trono' } as any,
      versions: [{ id: 'v1', name: 'Original', key: 'G', classificationIds: [], links: [] }],
    } as unknown as Song;

    expect(() => {
      render(<SongCard song={songWithObjArtist} onTap={vi.fn()} />);
    }).not.toThrow();

    expect(screen.getByText('A Batalha')).toBeInTheDocument();
    expect(screen.getByText('Diante do Trono')).toBeInTheDocument();
  });

  it('deve usar artistName como fallback quando song.artist estiver ausente', () => {
    const song: Song = {
      id: 'song-3',
      title: 'Ele Vive',
      artist: '',
      artistName: 'Cantor Cristão',
      versions: [{ id: 'v1', name: 'Original', key: 'D', classificationIds: [], links: [] }],
    };

    render(<SongCard song={song} onTap={vi.fn()} />);
    expect(screen.getByText('Cantor Cristão')).toBeInTheDocument();
  });

  it('deve renderizar Artista não especificado quando nenhum artista for informado', () => {
    const song: Song = {
      id: 'song-4',
      title: 'Hino Instrumental',
      artist: '',
      versions: [{ id: 'v1', name: 'Original', key: 'A', classificationIds: [], links: [] }],
    };

    render(<SongCard song={song} onTap={vi.fn()} />);
    expect(screen.getByText(/especificado/i)).toBeInTheDocument();
  });
});
