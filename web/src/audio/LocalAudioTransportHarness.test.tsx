import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalAudioTransportHarness } from './LocalAudioTransportHarness';
import {
  LocalAudioTransportController,
  type MediaElementLike,
} from './local-audio-transport';

class HarnessFakeMediaElement implements MediaElementLike {
  src = '';
  autoplay = false;
  preload = 'metadata';
  currentTime = 0;
  duration = 3;
  playbackRate = 1;
  preservesPitch = true;
  volume = 1;
  paused = true;
  error: { code?: number; message?: string } | null = null;
  private listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const evt = new Event(type);
    for (const listener of [...set]) {
      listener(evt);
    }
  }

  removeAttribute(qualifiedName: string): void {
    if (qualifiedName === 'src') {
      this.src = '';
    }
  }

  load(): void {
    if (!this.src) return;
    queueMicrotask(() => {
      this.dispatch('loadedmetadata');
    });
  }

  async play(): Promise<void> {
    this.paused = false;
    this.dispatch('playing');
  }

  pause(): void {
    this.paused = true;
    this.dispatch('pause');
  }
}

function createHarnessTestController() {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  let seq = 0;
  const controller = new LocalAudioTransportController(
    {
      accountNamespace: 'user-a',
      ministryId: 'ministry-a',
      songId: 'song-1',
      versionId: 'ver-1',
    },
    {
      createAudioElement: () => new HarnessFakeMediaElement(),
      createAudioContext: () => null,
      createObjectURL: vi.fn(() => {
        seq += 1;
        const url = `blob:harness/${seq}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    }
  );
  return { controller, createdUrls, revokedUrls };
}

describe('LocalAudioTransportHarness', () => {
  it('keeps single transport session playing across child subscreen unmounts and mounts', async () => {
    const { controller, createdUrls, revokedUrls } =
      createHarnessTestController();

    render(<LocalAudioTransportHarness controller={controller} />);

    expect(screen.getByTestId('harness-screen-detail')).toBeInTheDocument();
    expect(screen.queryByTestId('harness-screen-stand')).toBeNull();

    // Load fixture -> ready without autoplay
    fireEvent.click(
      screen.getByRole('button', { name: /Carregar fixture 880 Hz/i })
    );
    await waitFor(() => {
      expect(screen.getByTestId('transport-status-readout')).toHaveTextContent(
        'Estado: ready'
      );
    });
    expect(screen.getByTestId('transport-status-readout')).toHaveTextContent(
      'Arquivo: fixture-880hz-3s.wav'
    );

    // Start playback
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => {
      expect(screen.getByTestId('transport-status-readout')).toHaveTextContent(
        'Estado: playing'
      );
    });

    // Seek to 50% inside Detail view
    fireEvent.click(
      screen.getByRole('button', { name: /Saltar para 50% nesta tela/i })
    );
    const halfFrames = Math.round(controller.getSnapshot().totalFrames * 0.5);
    expect(controller.getSnapshot().currentFrame).toBe(halfFrames);

    // Navigate to Stand -> Detail unmounts cleanly, playback remains active at same frame
    fireEvent.click(screen.getByRole('button', { name: 'Ir para Estante' }));
    expect(screen.queryByTestId('harness-screen-detail')).toBeNull();
    expect(screen.getByTestId('harness-screen-stand')).toBeInTheDocument();
    expect(screen.getByTestId('harness-screen-stand')).toHaveTextContent(
      `playing (frame ${halfFrames}`
    );

    // Adjust speed and preservePitch while playing across navigation
    fireEvent.click(screen.getByRole('button', { name: '1.25x' }));
    expect(screen.getByTestId('transport-status-readout')).toHaveTextContent(
      'Taxa: 1.25x'
    );

    // Navigate to Schedule -> Stand unmounts, session still playing
    fireEvent.click(screen.getByRole('button', { name: 'Ir para Escala' }));
    expect(screen.queryByTestId('harness-screen-stand')).toBeNull();
    expect(screen.getByTestId('harness-screen-schedule')).toBeInTheDocument();
    expect(controller.getSnapshot().state).toBe('playing');
    expect(createdUrls).toHaveLength(1);
    expect(revokedUrls).toHaveLength(0);

    // Switch file -> pauses old playback, revokes previous blob URL, never autoplays
    fireEvent.click(
      screen.getByRole('button', { name: /Carregar fixture 440 Hz/i })
    );
    await waitFor(() => {
      const readout = screen.getByTestId('transport-status-readout');
      expect(readout).toHaveTextContent('Arquivo: fixture-440hz-2s.wav');
      expect(readout).toHaveTextContent('Estado: ready');
    });
    expect(controller.getSnapshot().state).toBe('ready');
    expect(controller.getSnapshot().currentFrame).toBe(0);
    expect(revokedUrls).toEqual(['blob:harness/1']);

    // Play again then switch ministry in Schedule screen -> stops & releases URL
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => {
      expect(controller.getSnapshot().state).toBe('playing');
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Trocar para Ministério B' })
    );
    expect(controller.getSnapshot().state).toBe('idle');
    expect(revokedUrls).toEqual(['blob:harness/1', 'blob:harness/2']);

    controller.dispose();
  });

  it('disposes internally owned controller when harness unmounts without leaking active URLs', async () => {
    const created: LocalAudioTransportController[] = [];
    const revokedUrls: string[] = [];

    const { unmount } = render(
      <LocalAudioTransportHarness
        createController={() => {
          const ctrl = new LocalAudioTransportController(undefined, {
            createAudioElement: () => new HarnessFakeMediaElement(),
            createAudioContext: () => null,
            createObjectURL: () => 'blob:owned/1',
            revokeObjectURL: (url) => revokedUrls.push(url),
          });
          created.push(ctrl);
          return ctrl;
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Carregar fixture 880 Hz/i })
    );
    await waitFor(() => {
      expect(created[0].getSnapshot().state).toBe('ready');
    });

    unmount();
    expect(created[0].getDiagnostics().disposed).toBe(true);
    expect(revokedUrls).toEqual(['blob:owned/1']);
  });

  it('keeps an externally injected controller alive when harness unmounts', async () => {
    const { controller, revokedUrls } = createHarnessTestController();

    const { unmount } = render(
      <LocalAudioTransportHarness controller={controller} />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Carregar fixture 880 Hz/i })
    );
    await waitFor(() => {
      expect(controller.getSnapshot().state).toBe('ready');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => {
      expect(controller.getSnapshot().state).toBe('playing');
    });

    unmount();
    expect(controller.getDiagnostics().disposed).toBe(false);
    expect(controller.getSnapshot().state).toBe('playing');
    expect(revokedUrls).toEqual([]);

    controller.dispose();
    expect(controller.getDiagnostics().disposed).toBe(true);
    expect(revokedUrls).toEqual(['blob:harness/1']);
  });

  it('recovers cleanly under React StrictMode double-effect lifecycle and still cleans up on real unmount', async () => {
    const created: LocalAudioTransportController[] = [];
    const revokedUrls: string[] = [];
    let urlSeq = 0;

    const { unmount } = render(
      <StrictMode>
        <LocalAudioTransportHarness
          createController={() => {
            const ctrl = new LocalAudioTransportController(undefined, {
              createAudioElement: () => new HarnessFakeMediaElement(),
              createAudioContext: () => null,
              createObjectURL: () => {
                urlSeq += 1;
                return `blob:strict/${urlSeq}`;
              },
              revokeObjectURL: (url) => revokedUrls.push(url),
            });
            created.push(ctrl);
            return ctrl;
          }}
        />
      </StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByTestId('transport-status-readout')).toHaveTextContent(
        'Estado: idle'
      );
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Carregar fixture 880 Hz/i })
    );
    await waitFor(() => {
      expect(screen.getByTestId('transport-status-readout')).toHaveTextContent(
        'Estado: ready'
      );
    });

    unmount();
    expect(created.every((ctrl) => ctrl.getDiagnostics().disposed)).toBe(true);
    expect(revokedUrls).toEqual(['blob:strict/1']);
  });
});
