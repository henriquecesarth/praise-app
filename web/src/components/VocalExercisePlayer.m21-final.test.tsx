import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VocalExercisePlayer } from './VocalExercisePlayer';
import {
  VOCAL_EXERCISES,
  midiLabel,
  midiFromNoteAndOctave,
  noteAndOctaveFromMidi,
} from '../vocal-exercises';
import { api } from '../api';

vi.mock('../audio/sampled-piano', () => ({
  SampledPiano: class {
    output = {};
    load = vi.fn(async () => undefined);
    noteOn = vi.fn();
    stop = vi.fn();
    fadeOut = vi.fn(async () => undefined);
    fadeIn = vi.fn();
  },
}));

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(async () => ({
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
      preferences: {
        vocalMinMidi: 50,
        vocalMaxMidi: 80,
      },
    })),
    updateUserPreferences: vi.fn(async (prefs) => ({ preferences: prefs })),
    getCustomVocalExercises: vi.fn(async () => [
      {
        id: 'custom-1',
        title: 'Meu Exercício Salvo',
        description: 'Vocalize pessoal',
        notes: [60, 64, 67],
        noteDurations: [1, 1, 2],
        minTranspose: -6,
        maxTranspose: 6,
        category: 'ascendente',
        isCustom: true,
      },
    ]),
    createCustomVocalExercise: vi.fn(async (data) => ({
      id: 'custom-new',
      ...data,
      isCustom: true,
    })),
    updateCustomVocalExercise: vi.fn(async (id, patch) => ({
      id,
      ...patch,
      isCustom: true,
    })),
    deleteCustomVocalExercise: vi.fn(async () => undefined),
  },
}));

describe('M21-FINAL: Vocal Notes Representation and Conversions', () => {
  it('converts Dó4 correctly to MIDI 60', () => {
    expect(midiLabel(60)).toBe('Dó4');
    expect(midiFromNoteAndOctave('Dó', 4)).toBe(60);
    expect(noteAndOctaveFromMidi(60)).toEqual({ note: 'Dó', octave: 4 });
  });

  it('converts Dó3 correctly to MIDI 48', () => {
    expect(midiLabel(48)).toBe('Dó3');
    expect(midiFromNoteAndOctave('Dó', 3)).toBe(48);
  });

  it('converts Dó5 correctly to MIDI 72 and Dó6 to MIDI 84', () => {
    expect(midiLabel(72)).toBe('Dó5');
    expect(midiLabel(84)).toBe('Dó6');
    expect(midiFromNoteAndOctave('Dó', 5)).toBe(72);
    expect(midiFromNoteAndOctave('Dó', 6)).toBe(84);
  });
});

describe('M21-FINAL: Catalog Preservation & Descending Exercises', () => {
  it('preserves the original 30 exercises and has at least 40 total exercises', () => {
    expect(VOCAL_EXERCISES.length).toBeGreaterThanOrEqual(40);

    for (let i = 1; i <= 30; i++) {
      const id = `vocal-${String(i).padStart(2, '0')}`;
      const found = VOCAL_EXERCISES.find((e) => e.id === id);
      expect(found).toBeDefined();
      expect(found!.notes.length).toBeGreaterThan(0);
      expect(found!.noteDurations.length).toBe(found!.notes.length);
    }
  });

  it('includes at least 10 new descending exercises (vocal-31 to vocal-40)', () => {
    for (let i = 31; i <= 40; i++) {
      const id = `vocal-${String(i).padStart(2, '0')}`;
      const found = VOCAL_EXERCISES.find((e) => e.id === id);
      expect(found).toBeDefined();
      expect(found!.category).toBe('descendente');
    }
  });

  it('has valid categories on every exercise in the catalog', () => {
    for (const ex of VOCAL_EXERCISES) {
      expect(['ascendente', 'descendente', 'misto']).toContain(ex.category);
    }
  });
});

describe('M21-FINAL: Player Component & Interactive Features', () => {
  beforeEach(() => {
    class AudioContextStub {
      state = 'running';
      currentTime = 0;
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal('AudioContext', AudioContextStub);
  });

  it('renders with keyboard hidden by default and toggles on/off with button', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    // Hidden by default
    expect(screen.queryByRole('region', { name: 'Teclado de piano' })).not.toBeInTheDocument();
    const toggleBtn = screen.getByRole('button', { name: /mostrar teclado/i });
    expect(toggleBtn).toBeInTheDocument();

    // Toggle on
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('region', { name: 'Teclado de piano' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ocultar teclado/i })).toBeInTheDocument();

    // Toggle off
    fireEvent.click(screen.getByRole('button', { name: /ocultar teclado/i }));
    expect(screen.queryByRole('region', { name: 'Teclado de piano' })).not.toBeInTheDocument();
  });

  it('restores saved user tessitura preferences on load', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    await waitFor(() => {
      const minSelect = screen.getByRole('combobox', { name: 'Nota mais grave' }) as HTMLSelectElement;
      expect(minSelect.value).toBe('50');
      const maxSelect = screen.getByRole('combobox', { name: 'Nota mais aguda' }) as HTMLSelectElement;
      expect(maxSelect.value).toBe('80');
    });
  });

  it('saves vocal range preferences via API when "Salvar minha extensão" is clicked', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.getMe).toHaveBeenCalled());

    const saveBtn = screen.getByRole('button', { name: /salvar minha extensão/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.updateUserPreferences).toHaveBeenCalledWith({
        vocalMinMidi: 50,
        vocalMaxMidi: 80,
      });
    });

    expect(await screen.findByText(/extensão vocal salva com sucesso/i)).toBeInTheDocument();
  });

  it('displays category tabs and filters exercises in the library', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: /todos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ascendentes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /descendentes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /mistos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /meus exercícios/i })).toBeInTheDocument();

    // Filter by custom exercises
    fireEvent.click(screen.getByRole('tab', { name: /meus exercícios/i }));
    expect(await screen.findByText('Meu Exercício Salvo')).toBeInTheDocument();
  });

  it('opens custom exercise modal when "Novo exercício" is clicked', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    const newBtn = screen.getByRole('button', { name: /novo exercício/i });
    fireEvent.click(newBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /novo exercício vocal/i })).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('M21-UX1: Collapsible Exercise Library & UX', () => {
  it('starts with exercise library expanded by default', () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    const collapseBtn = screen.getByRole('button', { name: /recolher/i });
    expect(collapseBtn).toBeInTheDocument();
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText(/buscar exercício/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /todos/i })).toBeInTheDocument();
  });

  it('automatically collapses library upon selecting an exercise and displays compact summary', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    // Initial state: expanded
    expect(screen.getByRole('button', { name: /recolher/i })).toBeInTheDocument();

    // Find and click an exercise card (e.g. Arpejo maior)
    const heading = screen.getByRole('heading', { name: /^arpejo maior$/i });
    const exerciseCard = heading.closest('.vocal-exercise-card')!;
    fireEvent.click(exerciseCard);

    // After selection, library should auto-collapse
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /recolher/i })).not.toBeInTheDocument();
      const changeBtn = screen.getByRole('button', { name: /trocar exercício/i });
      expect(changeBtn).toBeInTheDocument();
      expect(changeBtn).toHaveAttribute('aria-expanded', 'false');
    });

    // Content container is hidden
    const contentRegion = screen.getByLabelText('Catálogo de exercícios vocais');
    expect(contentRegion).toHaveAttribute('hidden');

    // Compact summary displays the selected exercise title, category and notes
    expect(screen.getByText('Exercício selecionado:')).toBeInTheDocument();
    expect(document.querySelector('.vocal-compact-title')?.textContent).toBe('Arpejo maior');
    expect(document.querySelector('.vocal-badge-direction')?.textContent).toContain('Misto');
    expect(document.querySelector('.vocal-compact-notes-count')?.textContent).toBe('7 notas');
  });

  it('allows manual collapse and manual expansion via toggle button', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    // 1. Manual collapse
    const collapseBtn = screen.getByRole('button', { name: /recolher/i });
    fireEvent.click(collapseBtn);

    expect(screen.queryByRole('button', { name: /recolher/i })).not.toBeInTheDocument();
    const changeBtn = screen.getByRole('button', { name: /trocar exercício/i });
    expect(changeBtn).toBeInTheDocument();
    expect(changeBtn).toHaveAttribute('aria-expanded', 'false');

    // 2. Manual expand
    fireEvent.click(changeBtn);

    expect(screen.getByRole('button', { name: /recolher/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/buscar exercício/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Catálogo de exercícios vocais')).not.toHaveAttribute('hidden');
  });

  it('preserves search query, category filter and selection across collapse and re-expansion', async () => {
    render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    // 1. Enter search term
    const searchInput = screen.getByPlaceholderText(/buscar exercício/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'Arpejo' } });
    expect(searchInput.value).toBe('Arpejo');

    // 2. Click category tab "Ascendentes"
    const tabAsc = screen.getByRole('tab', { name: /ascendentes/i });
    fireEvent.click(tabAsc);
    expect(tabAsc).toHaveAttribute('aria-selected', 'true');

    // 3. Manually collapse
    fireEvent.click(screen.getByRole('button', { name: /recolher/i }));
    expect(screen.getByRole('button', { name: /trocar exercício/i })).toBeInTheDocument();

    // 4. Re-expand
    fireEvent.click(screen.getByRole('button', { name: /trocar exercício/i }));

    // 5. Assert search term and tab are preserved
    const reSearchInput = screen.getByPlaceholderText(/buscar exercício/i) as HTMLInputElement;
    expect(reSearchInput.value).toBe('Arpejo');
    const reTabAsc = screen.getByRole('tab', { name: /ascendentes/i });
    expect(reTabAsc).toHaveAttribute('aria-selected', 'true');
  });

  it('supports keyboard navigation (Enter/Space) to toggle and select', async () => {
    const { container } = render(
      <MemoryRouter>
        <VocalExercisePlayer />
      </MemoryRouter>
    );

    // Toggle collapse with Enter
    const collapseBtn = screen.getByRole('button', { name: /recolher/i });
    fireEvent.keyDown(collapseBtn, { key: 'Enter', code: 'Enter' });

    // Toggle expand with Space
    const changeBtn = screen.getByRole('button', { name: /trocar exercício/i });
    fireEvent.keyDown(changeBtn, { key: ' ', code: 'Space' });

    // Select card with Enter key
    const card = container.querySelectorAll('.vocal-exercise-card')[1] as HTMLElement;
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /trocar exercício/i })).toBeInTheDocument();
      expect(document.querySelector('.vocal-compact-title')).toBeInTheDocument();
    });
  });
});
