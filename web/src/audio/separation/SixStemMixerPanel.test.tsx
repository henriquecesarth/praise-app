import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_STEM_IDS,
  STEM_DISPLAY_LABELS_PT_BR,
  computeSha256Hex,
  encodeStereoPcm16Wav,
  type SeparatedStemOutput,
} from './demucs-onnx-separator';
import { SixStemMixerPanel } from './SixStemMixerPanel';
import {
  SixStemWebAudioMixerController,
  type MixerAudioBufferLike,
  type MixerAudioContextLike,
  type MixerBufferSourceNodeLike,
  type MixerGainNodeLike,
} from './six-stem-mixer';

function createPanelFakeAudioContext(): MixerAudioContextLike {
  return {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    createGain: (): MixerGainNodeLike => ({
      gain: { value: 1 },
      connect: (d) => d,
      disconnect: () => {},
    }),
    createBuffer: (channels, length, sampleRate): MixerAudioBufferLike => {
      const ch = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: (idx) => ch[idx],
      };
    },
    createBufferSource: (): MixerBufferSourceNodeLike => ({
      buffer: null,
      onended: null,
      connect: (d) => d,
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    }),
    resume: async () => {},
    close: async () => {},
  };
}

async function createPanelStems(): Promise<SeparatedStemOutput[]> {
  const totalFrames = 4410;
  const sampleRate = 44100;
  const out: SeparatedStemOutput[] = [];
  for (const id of CANONICAL_STEM_IDS) {
    const left = new Float32Array(totalFrames).fill(0.15);
    const right = new Float32Array(totalFrames).fill(-0.15);
    const wavBytes = encodeStereoPcm16Wav({ sampleRate, left, right });
    const sha256 = await computeSha256Hex(wavBytes);
    out.push({
      id,
      labelPtBr: STEM_DISPLAY_LABELS_PT_BR[id],
      sampleRate,
      channels: 2,
      totalFrames,
      left,
      right,
      wavBytes,
      byteLength: wavBytes.byteLength,
      sha256,
      rms: 0.15,
      peak: 0.15,
    });
  }
  return out;
}

describe('SixStemMixerPanel (M22-B)', () => {
  it('renders 6 synchronized tracks, supports play/pause/seek/mute/solo/volume/WAV export/two libraries, and disposes on unmount', async () => {
    const stems = await createPanelStems();
    let seq = 0;
    const revokeSpy = vi.fn();
    const controller = new SixStemWebAudioMixerController({
      createAudioContext: () => createPanelFakeAudioContext(),
      createObjectURL: () => `blob:panel-stem-${++seq}`,
      revokeObjectURL: revokeSpy,
    });

    const loadingEvents: boolean[] = [];
    const { rerender, unmount } = render(
      <SixStemMixerPanel
        stems={stems}
        createController={() => controller}
        onLoadingChange={(loading) => loadingEvents.push(loading)}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('m22b-mixer-status')).toHaveAttribute(
        'data-state',
        'ready'
      );
    });
    expect(loadingEvents[0]).toBe(true);
    expect(loadingEvents.at(-1)).toBe(false);
    expect(loadingEvents.some((v, i) => i > 0 && v === false && loadingEvents[i - 1] === true && i < loadingEvents.length - 1)).toBe(false);

    // All 6 channels and WAV export links exist
    for (const id of CANONICAL_STEM_IDS) {
      expect(screen.getByTestId(`m22b-stem-channel-${id}`)).toBeInTheDocument();
      const exportLink = screen.getByTestId(`m22b-stem-export-${id}`);
      expect(exportLink).toHaveAttribute('download', `${id}.wav`);
      expect(exportLink.getAttribute('href')).toMatch(/^blob:panel-stem-/);
    }

    // Play & Seek
    fireEvent.click(screen.getByTestId('m22b-mixer-play'));
    await waitFor(() => {
      expect(screen.getByTestId('m22b-mixer-status')).toHaveAttribute(
        'data-state',
        'playing'
      );
    });
    expect(screen.getByTestId('m22b-mixer-sync-badge')).toHaveTextContent(
      '0.000 ms'
    );

    fireEvent.change(screen.getByTestId('m22b-mixer-seek'), {
      target: { value: '2205' },
    });
    expect(screen.getByTestId('m22b-mixer-position')).toHaveTextContent(
      'frame 2205/4410'
    );

    // Mute, Solo, Volume
    fireEvent.click(screen.getByTestId('m22b-stem-mute-drums'));
    expect(screen.getByTestId('m22b-stem-audible-drums')).toHaveAttribute(
      'data-audible',
      'false'
    );

    fireEvent.click(screen.getByTestId('m22b-stem-solo-vocals'));
    expect(screen.getByTestId('m22b-stem-audible-vocals')).toHaveAttribute(
      'data-audible',
      'true'
    );
    expect(screen.getByTestId('m22b-stem-audible-guitar')).toHaveAttribute(
      'data-audible',
      'false'
    );

    fireEvent.change(screen.getByTestId('m22b-stem-volume-vocals'), {
      target: { value: '0.6' },
    });
    expect(screen.getByTestId('m22b-stem-audible-vocals')).toHaveTextContent(
      'Ativa (60%)'
    );

    fireEvent.change(screen.getByTestId('m22b-stem-volume-vocals'), {
      target: { value: '0' },
    });
    expect(screen.getByTestId('m22b-stem-audible-vocals')).toHaveAttribute(
      'data-audible',
      'false'
    );
    fireEvent.change(screen.getByTestId('m22b-stem-volume-vocals'), {
      target: { value: '0.6' },
    });

    // Only two target libraries (no personal library)
    const librarySelect = screen.getByTestId(
      'm22b-target-library-select'
    ) as HTMLSelectElement;
    expect(Array.from(librarySelect.options).map((o) => o.value)).toEqual([
      'ministry_library',
      'louvaio_library',
    ]);
    fireEvent.change(librarySelect, { target: { value: 'louvaio_library' } });
    expect(librarySelect.value).toBe('louvaio_library');

    // Pause & Stop
    fireEvent.click(screen.getByTestId('m22b-mixer-pause'));
    expect(screen.getByTestId('m22b-mixer-status')).toHaveAttribute(
      'data-state',
      'paused'
    );
    fireEvent.click(screen.getByTestId('m22b-mixer-stop'));
    expect(screen.getByTestId('m22b-mixer-status')).toHaveAttribute(
      'data-state',
      'ready'
    );

    // Passing stems=null clears controller audio and revokes previous blob URLs
    rerender(
      <SixStemMixerPanel stems={null} createController={() => controller} />
    );
    await waitFor(() => {
      expect(controller.getSnapshot().state).toBe('idle');
    });
    expect(revokeSpy).toHaveBeenCalledTimes(6);

    // Unmount disposes owned controller
    unmount();
    expect(controller.getDiagnostics().disposed).toBe(true);
  });

  it('does not emit spurious intermediate false loading transitions under React.StrictMode', async () => {
    const stems = await createPanelStems();
    const createdControllers: SixStemWebAudioMixerController[] = [];
    const loadingEvents: boolean[] = [];

    const { unmount } = render(
      <StrictMode>
        <SixStemMixerPanel
          stems={stems}
          createController={() => {
            const c = new SixStemWebAudioMixerController({
              createAudioContext: () => createPanelFakeAudioContext(),
              createObjectURL: () =>
                `blob:strict-panel-${createdControllers.length}-${Math.random()}`,
              revokeObjectURL: () => {},
            });
            createdControllers.push(c);
            return c;
          }}
          onLoadingChange={(loading) => loadingEvents.push(loading)}
        />
      </StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByTestId('m22b-mixer-status')).toHaveAttribute(
        'data-state',
        'ready'
      );
    });

    expect(loadingEvents).toEqual([true, false]);

    unmount();
    await Promise.resolve();
    expect(loadingEvents).toEqual([true, false]);
    expect(createdControllers.every((c) => c.getDiagnostics().disposed)).toBe(
      true
    );
  });
});
