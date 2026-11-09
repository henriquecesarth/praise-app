import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateSongModal } from './CreateSongModal';
import { VersionEditModal } from './VersionEditModal';
import { SongFormModal } from './SongFormModal';
import { api } from '../api';
import { Artist, Classification, Song } from '../types';

const mockClassifications: Classification[] = [
  {
    id: 'cls-adoracao',
    ministryId: 'min-1',
    name: 'Adoração',
    color: '#0F2A1F',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cls-celebracao',
    ministryId: 'min-1',
    name: 'Celebração',
    color: '#C79A3B',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const mockArtists: Artist[] = [
  {
    id: 'art-1',
    ministryId: 'min-1',
    name: 'Gabriel Guedes',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const existingMultiVersionSong: Song = {
  id: 'song-100',
  ministryId: 'min-1',
  title: 'Santo Pra Sempre',
  artist: 'Gabriel Guedes',
  artistId: 'art-1',
  notes: 'Subir dinâmica no refrão final.',
  versions: [
    {
      id: 'ver-fixed-1',
      name: 'Original (Estúdio)',
      key: 'G',
      bpm: 72,
      duration: '00:05:40',
      notes: 'Arranjo original com piano',
      classificationIds: ['cls-adoracao'],
      links: [
        { label: 'Letra', url: 'https://letras.mus.br/santo' },
        { label: 'Cifra', url: '' },
        { label: 'Áudio', url: '' },
        { label: 'Vídeo', url: 'https://youtube.com/watch?v=santo1' },
        { label: 'Multitrack', url: 'https://loops.com/santo', isCustom: true },
      ],
    },
    {
      id: 'ver-fixed-2',
      name: 'Acústica Jovens',
      key: 'E',
      bpm: 68,
      duration: '00:04:30',
      notes: 'Violão solo',
      classificationIds: ['cls-celebracao'],
      links: [
        { label: 'Letra', url: '' },
        { label: 'Cifra', url: 'https://cifraclub.com.br/santo' },
        { label: 'Áudio', url: '' },
        { label: 'Vídeo', url: '' },
      ],
    },
  ],
};

describe('CreateSongModal & VersionEditModal (D2-B Delivery 3)', () => {
  it('preserves raw optional fields and resource IDs across API mapping and a no-op version edit', async () => {
    const rawVersions = [
      { id: 'nulls', name: 'Null values', key: null, notes: null, bpm: null, duration: null },
      { id: 'empty', name: 'Empty arrays', key: 'G', classificationIds: [], links: [] },
      { id: 'links', name: 'Legacy resource', key: 'E', links: [{ id: 'stable-link', label: 'Vídeo', url: 'example.test/video', metadata: 'keep' }] },
    ];
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: {
      id: 'optional-song', title: 'Optional song', artist: { id: 'old-artist', name: 'Old artist' },
      artist_id: 'old-artist', ministry_id: 'min-1', versions: rawVersions,
    } }), { status: 200 }));
    try {
      const song = await api.getSongById('optional-song', 'min-1');
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<CreateSongModal song={song} classifications={[]} onSave={onSave} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Editar versão Null values' }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar Versão' }));
      fireEvent.change(screen.getByLabelText(/Título da Música/i), { target: { value: 'Updated title' } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar Música/i }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0].versions).toEqual(rawVersions);
      expect(onSave.mock.calls[0][0].artistId).toBe('old-artist');
      await api.updateSong(song.id, { artist: 'New free artist', versions: song.versions }, 'min-1');
      const body = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));
      expect(body.artist_id).toBeNull();
      expect(body.versions).toEqual(rawVersions);
      await api.updateSong(song.id, { title: 'Legacy metadata', versions: [
        { id: 'legacy', name: 'Legacy' } as Song['versions'][number],
      ] }, 'min-1');
      const legacyBody = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));
      for (const field of ['original_key', 'bpm', 'duration', 'external_links']) {
        expect(legacyBody).not.toHaveProperty(field);
      }
    } finally { fetchSpy.mockRestore(); }
  });

  it('keeps custom and duplicate standard resource identities when a standard URL changes', () => {
    const custom = { id: 'custom-cifra', label: 'Cifra', url: 'example.test/custom', isCustom: true };
    const onSave = vi.fn();
    render(<VersionEditModal version={{ id: 'version', name: 'Original', key: 'G', classificationIds: [], links: [
      custom, { id: 'video-1', label: 'Vídeo', url: 'example.test/one' },
      { id: 'video-2', label: 'Vídeo', url: 'example.test/two' },
    ] }} classifications={[]} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Vídeo \(/i), { target: { value: 'example.test/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Versão' }));
    const links = onSave.mock.calls[0][0].links;
    expect(links.filter((link: { id: string }) => link.id === custom.id)).toEqual([custom]);
    expect(links.map((link: { id: string }) => link.id).sort()).toEqual(['custom-cifra', 'video-1', 'video-2']);
    expect(links.find((link: { id: string }) => link.id === 'video-2').url).toBe('example.test/two');
  });

  it('Escape closes only the active version dialog before closing its parent', () => {
    const onClose = vi.fn();
    render(<CreateSongModal song={existingMultiVersionSong} classifications={[]} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar versão Acústica Jovens' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Editar Versão da Música')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cria música com 1 versão, exibe indicador de alterações não salvas e vincula artistId quando corresponde ao artista do ministério', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <SongFormModal
        artists={mockArtists}
        classifications={mockClassifications}
        onSave={onSave}
        onClose={onClose}
      />
    );

    expect(screen.getByText('Nova Música')).toBeTruthy();
    expect(screen.queryByText('Alterações não salvas')).toBeNull();
    expect(screen.getByText('Principal')).toBeTruthy();
    expect(screen.getByText('0 links')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Título da Música/i), {
      target: { value: 'Bondade de Deus' },
    });
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Artista \/ Compositor/i), {
      target: { value: 'Gabriel Guedes' },
    });
    fireEvent.change(screen.getByLabelText(/Observações Gerais/i), {
      target: { value: 'Iniciar apenas com voz e teclado' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Salvar Música/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const savedPayload = onSave.mock.calls[0][0];
    expect(savedPayload.title).toBe('Bondade de Deus');
    expect(savedPayload.artist).toBe('Gabriel Guedes');
    expect(savedPayload.artistId).toBe('art-1');
    expect(savedPayload.notes).toBe('Iniciar apenas com voz e teclado');
    expect(savedPayload.versions).toHaveLength(1);
    expect(savedPayload.versions[0].name).toBe('Original');
    expect(savedPayload.versions[0].key).toBe('G');
    expect(savedPayload.versions[0].id).toBeTruthy();
  });

  it('cria música com múltiplas versões, edita grupos da versão (andamento, classificações e links customizados) e salva tudo', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateSongModal
        classifications={mockClassifications}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/Título da Música/i), {
      target: { value: 'A Casa é Sua' },
    });

    // Adicionar segunda versão (abre automaticamente o VersionEditModal para a nova versão)
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Versão/i }));

    expect(screen.getByText('Editar Versão da Música')).toBeTruthy();
    expect(screen.getByText('1. Identificação e Andamento')).toBeTruthy();
    expect(screen.getByText('2. Classificações e Observações')).toBeTruthy();
    expect(screen.getByText('3. Links & Recursos da Versão')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Nome da Versão/i), {
      target: { value: 'Ao Vivo Conferência' },
    });
    fireEvent.change(screen.getByLabelText(/^Tom \*/i), {
      target: { value: 'Bb' },
    });
    fireEvent.change(screen.getByLabelText(/^BPM/i), {
      target: { value: '76' },
    });
    fireEvent.change(screen.getByLabelText(/Minutos \(MM\)/i), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByLabelText(/Segundos \(SS\)/i), {
      target: { value: '15' },
    });

    // Selecionar classificação
    fireEvent.click(screen.getByRole('button', { name: 'Adoração' }));

    // Observações da versão
    fireEvent.change(screen.getByLabelText(/Observações da Versão/i), {
      target: { value: 'Subida de tom na ponte final' },
    });

    // Links padrão e customizado
    fireEvent.change(screen.getByLabelText(/Vídeo \(ex: YouTube\)/i), {
      target: { value: 'https://youtube.com/watch?v=casa1' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Adicionar Link Customizado/i }));
    fireEvent.change(screen.getByLabelText(/Rótulo \(ex: Partitura\)/i), {
      target: { value: 'Partitura Vocal' },
    });
    fireEvent.change(screen.getByLabelText(/^URL \(ex: https:\/\/\.\.\.\)/i), {
      target: { value: 'https://drive.google.com/partitura' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Salvar Versão/i }));

    // Modal da versão fechou e a lista exibe 2 versões com contagem de links correta
    expect(screen.queryByText('Editar Versão da Música')).toBeNull();
    expect(screen.getByText('Versões (2)')).toBeTruthy();
    expect(screen.getByText('Ao Vivo Conferência')).toBeTruthy();
    expect(screen.getByText('Tom: Bb')).toBeTruthy();
    expect(screen.getByText('76 BPM')).toBeTruthy();
    expect(screen.getByText('06:15')).toBeTruthy();
    expect(screen.getByText('2 links')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Salvar Música/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const saved = onSave.mock.calls[0][0];
    expect(saved.versions).toHaveLength(2);
    expect(saved.versions[0].id).not.toBe(saved.versions[1].id);
    expect(saved.versions[1]).toMatchObject({
      name: 'Ao Vivo Conferência',
      key: 'Bb',
      bpm: '76',
      duration: '00:06:15',
      notes: 'Subida de tom na ponte final',
      classificationIds: ['cls-adoracao'],
    });
    expect(saved.versions[1].links).toEqual(
      expect.arrayContaining([
        { label: 'Vídeo', url: 'https://youtube.com/watch?v=casa1' },
        expect.objectContaining({
          label: 'Partitura Vocal',
          url: 'https://drive.google.com/partitura',
          isCustom: true,
        }),
      ])
    );
  });

  it('edita metadados e edita 1 versão sem alterar as demais nem regenerar IDs existentes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateSongModal
        song={existingMultiVersionSong}
        artists={mockArtists}
        classifications={mockClassifications}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Editar Música')).toBeTruthy();
    expect(screen.getByLabelText(/Título da Música/i)).toHaveValue('Santo Pra Sempre');
    expect(screen.getByText('3 links')).toBeTruthy();
    expect(screen.getByText('1 link')).toBeTruthy();

    // Editar apenas a versão 2
    fireEvent.click(screen.getByRole('button', { name: 'Editar versão Acústica Jovens' }));

    fireEvent.change(screen.getByLabelText(/^BPM/i), {
      target: { value: '70' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar Versão/i }));

    // Salvar música
    fireEvent.click(screen.getByRole('button', { name: /Salvar Música/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const saved = onSave.mock.calls[0][0];
    expect(saved.versions).toHaveLength(2);
    // IDs originais preservados
    expect(saved.versions[0].id).toBe('ver-fixed-1');
    expect(saved.versions[1].id).toBe('ver-fixed-2');
    // Versão 1 intacta
    expect(saved.versions[0].name).toBe('Original (Estúdio)');
    expect(saved.versions[0].key).toBe('G');
    expect(saved.versions[0].bpm).toBe(72);
    expect(saved.versions[0].notes).toBe('Arranjo original com piano');
    // Versão 2 atualizada preservando tipo numérico de bpm
    expect(saved.versions[1].bpm).toBe(70);
    expect(saved.versions[1].key).toBe('E');
  });

  it('clona uma versão atribuindo ID único e exclui uma versão sem afetar as demais', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateSongModal
        song={existingMultiVersionSong}
        classifications={mockClassifications}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    // Clonar versão 1
    fireEvent.click(screen.getByRole('button', { name: 'Clonar versão Original (Estúdio)' }));
    expect(screen.getByText('Versões (3)')).toBeTruthy();
    expect(screen.getByText('Cópia de Original (Estúdio)')).toBeTruthy();

    // Excluir versão 2 ("Acústica Jovens")
    fireEvent.click(screen.getByRole('button', { name: 'Excluir versão Acústica Jovens' }));
    expect(screen.getByText('Versões (2)')).toBeTruthy();
    expect(screen.queryByText('Acústica Jovens')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Salvar Música/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const saved = onSave.mock.calls[0][0];
    expect(saved.versions).toHaveLength(2);
    expect(saved.versions[0].id).toBe('ver-fixed-1');
    expect(saved.versions[1].id).not.toBe('ver-fixed-1');
    expect(saved.versions[1].id).not.toBe('ver-fixed-2');
    expect(saved.versions[1].name).toBe('Cópia de Original (Estúdio)');
    expect(saved.versions[1].key).toBe('G');
    expect(saved.versions[1].links).toEqual(saved.versions[0].links);
  });

  it('protege contra duplo submit durante salvamento em andamento', async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    render(
      <CreateSongModal
        song={existingMultiVersionSong}
        classifications={mockClassifications}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Salvar Música/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Salvando\.\.\./i })).toBeDisabled();

    resolveSave();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Salvar Música/i })).not.toBeDisabled();
    });
  });

  it('preserva fidelidade completa no round-trip da API (createSong -> updateSong -> getSongById) incluindo artist objeto, notas e múltiplas versões', async () => {
    const backendStore: Record<string, any> = {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (method === 'POST' && url.endsWith('/songs')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const created = {
          id: 'song-rt-1',
          ministry_id: 'min-1',
          user_id: 'user-1',
          ...body,
          artist: body.artist_id ? { id: body.artist_id, name: body.artist } : body.artist,
          created_at: '2026-11-09T12:00:00Z',
          updated_at: '2026-11-09T12:00:00Z',
        };
        backendStore[created.id] = created;
        return new Response(JSON.stringify({ data: created }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PUT' && url.includes('/songs/')) {
        const songId = url.split('/songs/')[1];
        const body = JSON.parse(String(init?.body || '{}'));
        backendStore[songId] = {
          ...backendStore[songId],
          ...body,
          updated_at: '2026-11-09T12:05:00Z',
        };
        return new Response(JSON.stringify({ data: backendStore[songId] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/songs/')) {
        const songId = url.split('/songs/')[1];
        return new Response(JSON.stringify({ data: backendStore[songId] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    try {
      const created = await api.createSong(
        {
          title: 'Santo Pra Sempre',
          artist: 'Gabriel Guedes',
          artistId: 'art-1',
          notes: 'Observação original',
          versions: existingMultiVersionSong.versions,
        },
        'min-1'
      );

      expect(created.title).toBe('Santo Pra Sempre');
      expect(created.artist).toBe('Gabriel Guedes');
      expect(created.artistId).toBe('art-1');
      expect(created.notes).toBe('Observação original');
      expect(created.versions).toHaveLength(2);
      expect(created.versions[0].id).toBe('ver-fixed-1');
      expect(created.versions[1].id).toBe('ver-fixed-2');

      // Atualizar limpando observações gerais e editando apenas a versão 2
      const updatedVersions = [
        created.versions[0],
        { ...created.versions[1], bpm: 74, notes: 'Violão 12 cordas' },
      ];
      await api.updateSong(
        created.id,
        {
          title: 'Santo Pra Sempre',
          artist: 'Gabriel Guedes',
          artistId: 'art-1',
          notes: '',
          versions: updatedVersions,
        },
        'min-1'
      );

      const reopened = await api.getSongById(created.id, 'min-1');
      expect(reopened.title).toBe('Santo Pra Sempre');
      expect(reopened.artist).toBe('Gabriel Guedes');
      expect(reopened.notes).toBeUndefined();
      expect(reopened.versions).toHaveLength(2);
      expect(reopened.versions[0].id).toBe('ver-fixed-1');
      expect(reopened.versions[1].id).toBe('ver-fixed-2');
      expect(reopened.versions[1].bpm).toBe(74);
      expect(reopened.versions[1].notes).toBe('Violão 12 cordas');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
