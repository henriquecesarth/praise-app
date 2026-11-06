import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildExerciseTimeline, buildProgressionTimeline, VocalExercisePlayer } from './VocalExercisePlayer';
import { VOCAL_EXERCISES } from '../vocal-exercises';
const pianoMock = vi.hoisted(() => ({ load: vi.fn(async (): Promise<void> => undefined) }));

// Lifecycle/transport checks only. Real sampled PCM is verified in headed Chromium.
vi.mock('../audio/sampled-piano', () => ({
  SampledPiano: class {
    output = {};
    load = pianoMock.load;
    noteOn = vi.fn();
    stop = vi.fn();
    fadeOut = vi.fn(async () => undefined);
    fadeIn = vi.fn();
  },
}));

describe('vocal exercise timeline', () => {
  it('ignores a failed old sample load after stop and a newer successful start', async () => {
    let rejectOld: (error: Error) => void = () => undefined;
    pianoMock.load.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    class AudioContextStub {
      state = 'running';
      currentTime = 0;
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal('AudioContext', AudioContextStub);
    const view = render(<MemoryRouter><VocalExercisePlayer /></MemoryRouter>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ativar metrônomo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tocar progressão' }));
    await waitFor(() => expect(pianoMock.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tocar progressão' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled());
    await act(async () => { rejectOld(new Error('old offline load failed')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled();
    view.unmount();
    vi.unstubAllGlobals();
  });
  it('does not schedule notes when unmounted while the audio context is resuming', async () => {
    let resolveResume: () => void = () => undefined;
    const createOscillator = vi.fn();
    const close = vi.fn(async () => undefined);
    class PendingAudioContext {
      state = 'suspended';
      resume = () => new Promise<void>((resolve) => { resolveResume = resolve; });
      close = close;
      createOscillator = createOscillator;
    }
    vi.stubGlobal('AudioContext', PendingAudioContext);
    const view = render(<MemoryRouter><VocalExercisePlayer /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Tocar progressão' }));
    view.unmount();
    await act(async () => { resolveResume(); });
    expect(createOscillator).not.toHaveBeenCalled();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    vi.unstubAllGlobals();
  });
  it('converts quarter-note durations to absolute event times at the selected BPM', () => {
    expect(buildExerciseTimeline([60, 62, 64], [1, 0.5, 2], 120, 2, 10)).toEqual([
      { midi: 62, startAt: 10, durationSeconds: 0.41 },
      { midi: 64, startAt: 10.5, durationSeconds: 0.205 },
      { midi: 66, startAt: 10.75, durationSeconds: 0.82 },
    ]);
  });

  it('progresses one semitone at a time in either direction, bounded by tessitura', () => {
    const up = buildProgressionTimeline([60, 64], [1, 1], 60, 0, 1, -1, 2);
    expect(up.map((event) => event.midi)).toEqual([59, 63, 60, 64, 61, 65, 62, 66]);
    const down = buildProgressionTimeline([60], [1], 60, 0, -1, -1, 2);
    expect(down.map((event) => event.midi)).toEqual([62, 61, 60, 59]);
  });

  it('keeps every catalog exercise within the configured playback tessitura when transposed', () => {
    for (const exercise of VOCAL_EXERCISES) {
      const minTranspose = Math.max(exercise.minTranspose, 48 - Math.min(...exercise.notes));
      const maxTranspose = Math.min(exercise.maxTranspose, 84 - Math.max(...exercise.notes));
      expect(Math.min(...exercise.notes) + minTranspose).toBeGreaterThanOrEqual(48);
      expect(Math.max(...exercise.notes) + maxTranspose).toBeLessThanOrEqual(84);
    }
  });

  it('rejects an empty tessitura range instead of flattening or clipping notes', () => {
    expect(() => buildProgressionTimeline([60], [1], 80, 0, 1, 4, 3)).toThrow(RangeError);
    expect(() => buildExerciseTimeline([60], [0], 80, 0, 0)).toThrow(RangeError);
  });

  it('cancels scheduled audio when the user stops playback', async () => {
    const oscillators: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
    class FakeAudioContext {
      currentTime = 0;
      state = 'running';
      destination = {};
      onstatechange: (() => void) | null = null;
      resume = vi.fn(async () => { this.state = 'running'; });
      suspend = vi.fn(async () => { this.state = 'suspended'; });
      close = vi.fn(async () => undefined);
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(function (this: unknown) { return this; }) };
      }
      createOscillator() {
        const oscillator = { frequency: { value: 0 }, type: '', connect: vi.fn(function (this: unknown) { return this; }), start: vi.fn(), stop: vi.fn(),
        };
        oscillators.push(oscillator);
        return oscillator;
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    render(<MemoryRouter><VocalExercisePlayer /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Tocar progressão' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Parar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retomar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators.every((oscillator) => oscillator.stop.mock.calls.length >= 2)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tocar progressão' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    vi.unstubAllGlobals();
  });
});
